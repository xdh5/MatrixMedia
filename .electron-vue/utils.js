'use strict'
const dotenv = require('dotenv')
const { join } = require("path")
const argv = require('minimist')(process.argv.slice(2));
const rootResolve = (...pathSegments) => join(__dirname, '..', ...pathSegments)

function getEnv() {
    return argv['m']
}
function getEnvPath() {
    if (String(typeof getEnv()) === 'boolean' || String(typeof getEnv()) === 'undefined') {
        return rootResolve('env/.env')
    }
    return rootResolve(`env/${getEnv()}.env`)
}
function getConfig() {
    return dotenv.config({ path: getEnvPath() }).parsed
}

exports.getEnv = getEnv()
exports.getConfig = getConfig()
