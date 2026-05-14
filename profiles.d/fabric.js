var async = require('async');
var path = require('path');
var fs = require('fs-extra');
var profile = require('./template');

exports.profile = {
  name: "Fabric Server Launcher",
  request_args: {
    url: 'https://meta.fabricmc.net/v2/versions',
    json: true
  },
  handler: function (profile_dir, body, callback) {
    var p = [];

    try {
      // body contains both game versions and loader versions
      var game_versions = body.game || [];
      var loader_versions = body.loader || [];

      // Filter to only stable releases (not snapshots)
      var stable_game = game_versions.filter(function(v) {
        return v.stable === true;
      }).slice(0, 20); // Limit to most recent 20 stable versions

      // Get a few recent loader versions
      var recent_loaders = loader_versions.slice(0, 5);

      // Create profile combinations of game versions x loader versions
      for (var g = 0; g < stable_game.length; g++) {
        for (var l = 0; l < recent_loaders.length; l++) {
          var game_ver = stable_game[g];
          var loader_ver = recent_loaders[l];
          
          var item = new profile();
          var profile_id = 'fabric-{0}-loader-{1}'.format(game_ver.version, loader_ver.version);
          
          item['id'] = profile_id;
          item['time'] = game_ver.releaseTime;
          item['releaseTime'] = game_ver.releaseTime;
          item['type'] = 'release';
          item['group'] = 'fabric';
          item['webui_desc'] = 'Fabric Loader {0} for Minecraft {1}'.format(loader_ver.version, game_ver.version);
          item['weight'] = 0;
          item['filename'] = 'fabric-server-launcher-{0}-{1}.jar'.format(game_ver.version, loader_ver.version);
          item['downloaded'] = fs.existsSync(path.join(profile_dir, item.id, item.filename));
          item['version'] = game_ver.version;
          item['release_version'] = game_ver.version;
          
          // Store metadata for lazy loading
          item['game_version'] = game_ver.version;
          item['loader_version'] = loader_ver.version;
          
          item['url'] = 'https://meta.fabricmc.net/v2/versions/loader/{0}/{1}/1.1.1/server/jar'.format(
            game_ver.version,
            loader_ver.version
          );
          p.push(item);
        }
      }
    } catch (e) {
      return callback(e);
    }

    callback(null, p);
  },

  postdownload: function (profile_dir, dest_filepath, callback) {
    callback();
  }
};
