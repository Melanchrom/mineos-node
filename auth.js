var async = require('async');
var auth = exports;

auth.authenticate_shadow = function(user, plaintext, callback) {
  var hash = require('sha512crypt-node');
  var fs = require('fs-extra');

  var debug = process.env.MINEOS_DEBUG === '1' || process.env.MINEOS_DEBUG === 'true';
  function debugLog() {
    if (!debug) return;
    console.log.apply(console, arguments);
  }

  function etc_shadow(inner_callback) {
    var passwd = require('etc-passwd');

    fs.stat('/etc/shadow', function(err, stat_info) {
      if (err) {
        debugLog('auth: /etc/shadow stat failed:', err.message || err);
        inner_callback(null, false);
        return;
      }

      passwd.getShadow({username: user}, function(err, shadow_info) {
        if (err) {
          debugLog('auth: /etc/shadow lookup failed for', user, 'error:', err.message || err);
          inner_callback(null, false);
          return;
        }

        if (!shadow_info) {
          debugLog('auth: no shadow entry found for user', user);
          inner_callback(null, false);
          return;
        }

        if (shadow_info.password == '!') {
          debugLog('auth: shadow password locked for', user);
          inner_callback(null, false);
          return;
        }

        if (!shadow_info.password || shadow_info.password.length < 3) {
          debugLog('auth: shadow password invalid or empty for', user);
          inner_callback(null, false);
          return;
        }

        var password_parts = shadow_info['password'].split(/\$/);
        if (password_parts.length < 4) {
          debugLog('auth: shadow password format invalid for', user, 'parts:', password_parts.length);
          inner_callback(null, false);
          return;
        }

        var hash_type = password_parts[1];
        if (hash_type !== '6') {
          debugLog('auth: shadow hash type', hash_type, 'not supported for', user, '(only sha512/$6 supported)');
          inner_callback(null, false);
          return;
        }

        var salt;
        if (password_parts[2] && password_parts[2].startsWith('rounds=')) {
          if (password_parts.length < 5) {
            debugLog('auth: shadow password format invalid for', user, 'rounds present but no salt');
            inner_callback(null, false);
            return;
          }
          salt = password_parts[2] + '$' + password_parts[3];
          debugLog('auth: shadow using rounds for', user);
        } else {
          salt = password_parts[2];
        }

        var new_hash = hash.sha512crypt(plaintext, salt);

        var passed = (new_hash == shadow_info['password'] ? user : false);
        if (passed)
          debugLog('auth: shadow authentication succeeded for', user);
        else
          debugLog('auth: shadow authentication failed for', user, '- password mismatch');

        inner_callback(null, passed);
      })
    })
  }

  function posix(inner_callback) {
    try {
      var crypt = require('apache-crypt');
      var posix = require('posix');
    } catch (e) {
      debugLog('auth: posix method unavailable:', e.message || e);
      inner_callback(null, false);
      return;
    }

    try {
      var user_data = posix.getpwnam(user);
      if (!user_data) {
        debugLog('auth: posix user not found:', user);
        inner_callback(null, false);
        return;
      }

      if (crypt(plaintext, user_data.passwd) == user_data.passwd) {
        debugLog('auth: posix authentication succeeded for', user);
        inner_callback(null, user);
        return;
      }

      var password_parts = user_data.passwd.split(/\$/);
      var salt = password_parts[2];
      var new_hash = hash.sha512crypt(plaintext, salt);
      var passed = (new_hash == user_data.passwd ? user : false);
      if (passed)
        debugLog('auth: posix sha512 fallback succeeded for', user);
      else
        debugLog('auth: posix authentication failed for', user);

      inner_callback(null, passed);
    } catch (e) {
      debugLog('auth: posix exception for', user, e.message || e);
      inner_callback(null, false);
    }
  }

  function pam(inner_callback) {
    try {
      var pam = require('authenticate-pam');
    } catch (e) {
      debugLog('auth: PAM module unavailable:', e.message || e);
      inner_callback(null, false);
      return;
    }

    pam.authenticate(user, plaintext, function(err) {
      if (err) {
        debugLog('auth: PAM authentication failed for', user, err.message || err);
        inner_callback(null, false);
      } else {
        debugLog('auth: PAM authentication succeeded for', user);
        inner_callback(null, user);
      }
    })
  }

  pam(function(pam_err, pam_passed) {
    if (pam_passed)
      callback(null, pam_passed);
    else
      etc_shadow(function(etc_err, etc_passed) {
        if (etc_passed)
          callback(null, etc_passed);
        else
          posix(function(posix_err, posix_passed) {
            if (posix_passed)
              callback(null, posix_passed);
            else
              callback(null, false);
          });
      });
  });
}

auth.test_membership = function(username, group, callback) {
  var passwd = require('etc-passwd');
  var userid = require('userid');

  var membership_valid = false;
  var gg = passwd.getGroups()
    .on('group', function(group_data) {
      if (group == group_data.groupname)
        try {
          if (group_data.users.indexOf(username) >= 0 || group_data.gid == userid.gids(username)[0])
            membership_valid = true;
        } catch (e) {}
    })
    .on('end', function() {
      callback(membership_valid);
    })
}

auth.verify_ids = function(uid, gid, callback) {
  var passwd = require('etc-passwd');

  var uid_present = false;
  var gid_present = false;

  async.series([
    function(cb) {
      var gg = passwd.getUsers()
        .on('user', function(user_data) {
          if (user_data.uid == uid)
            uid_present = true;
        })
        .on('end', function() {
          if (!uid_present)
            cb('UID ' + uid + ' does not exist on this system');
          else
            cb();
        })
    },
    function(cb) {
      var gg = passwd.getGroups()
        .on('group', function(group_data) {
          if (group_data.gid == gid)
            gid_present = true;
        })
        .on('end', function() {
          if (!gid_present)
            cb('GID ' + gid + ' does not exist on this system');
          else
            cb();
        })
    }
  ], callback)
}
