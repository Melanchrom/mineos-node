var async = require('async');
var path = require('path');
var fs = require('fs-extra');
var profile = require('./template');

exports.profile = {
  name: "Mojang Official Minecraft Jars",
  request_args: {
    url: 'https://piston-meta.mojang.com/mc/game/version_manifest.json',
    json: true
  },
  handler: function (profile_dir, body, callback) {
    var axios = require('axios');
    var p = [];

    var q = async.queue(function (obj, cb) {
      async.waterfall([
        function (inner_cb) {
          axios.get(obj.url).then(function (response) {
            inner_cb(null, response.status, response.data);
          }).catch(function (err) {
            inner_cb(err);
          });
        },
        function (statusCode, body, inner_cb) {
          if (statusCode !== 200) {
            return inner_cb(new Error('Unexpected status code: ' + statusCode));
          }
          inner_cb(null, body);
        },
        function (body, inner_cb) {
          // axios already parses JSON responses; no need to call JSON.parse
          var parsed = body;
          for (var idx in p) {
            if (p[idx]['id'] === obj['id']) {
              try {
                p[idx]['url'] = parsed['downloads']['server']['url'];
              } catch (e) {
                // Server jar not available for this version
              }
            }
          }
          inner_cb();
        }
      ], function (err) {
        // cb() is called here, after the waterfall completes, not before
        if (err) {
          console.error('Error processing version ' + obj.id + ':', err.message);
        }
        cb();
      });
    }, 2);

    q.pause();

    // Set drain before resume to avoid missing the event if the queue empties instantly
    q.drain = function () {
      callback(null, p);
    };

    try {
      for (var index in body.versions) {
        var item = new profile();
        var ref_obj = body.versions[index];
        item['id'] = ref_obj['id'];
        item['time'] = ref_obj['time'];
        item['releaseTime'] = ref_obj['releaseTime'];
        item['group'] = 'mojang';
        item['webui_desc'] = 'Official Mojang Jar';
        item['weight'] = 0;
        item['filename'] = 'minecraft_server.{0}.jar'.format(ref_obj['id']);
        item['downloaded'] = fs.existsSync(path.join(profile_dir, item.id, item.filename));
        item['version'] = ref_obj['id'];
        item['release_version'] = ref_obj['id'];

        switch (ref_obj['type']) {
          case 'release':
            item['type'] = ref_obj['type'];
            item['url'] = null; // Will be populated by the queue
            q.push({ id: item['id'], url: ref_obj.url });
            p.push(item);
            break;
          case 'snapshot':
            item['type'] = ref_obj['type'];
            item['url'] = null; // Will be populated by the queue
            q.push({ id: item['id'], url: ref_obj.url });
            p.push(item);
            break;
          default:
            // old_alpha, old_beta — no server jars available
            item['type'] = 'old_version';
            item['url'] = null;
            break;
        }
      }
    } catch (e) {
      return callback(e);
    }

    // If nothing was queued (e.g. only old_version entries), drain will never fire
    if (q.length() === 0 && q.running() === 0) {
      return callback(null, p);
    }

    q.resume();
  },

  postdownload: function (profile_dir, dest_filepath, callback) {
    callback();
  }
};