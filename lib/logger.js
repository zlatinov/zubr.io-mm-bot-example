fs = require('fs')

const {
    LOG_FILENAMES,
    LOG_LEVELS,
    LOG_LEVEL_INFO,
    LOG_LEVEL_ERROR,
    LOG_LEVEL_DEBUG,
} = require('../constants.js');

module.exports = function (level) {
    function info(message) {
        if (LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL_INFO]) {
            log(LOG_LEVEL_INFO, message)
        }
    }

    function error(message) {
        if (LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL_ERROR]) {
            log(LOG_LEVEL_ERROR, message)
        }
    }

    function debug(message) {
        if (LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL_DEBUG]) {
            log(LOG_LEVEL_DEBUG, message)
        }
    }

    function log(level, message) {
        fs.appendFileSync(LOG_FILENAMES[LOG_LEVELS[level]], (new Date().toUTCString()) + ': ' + message + "\n")
    }

    return {
        info,
        error,
        debug
    }
}