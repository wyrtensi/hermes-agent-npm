#!/usr/bin/env node

const { runNpmChannel } = require("../lib/npm-channel");

runNpmChannel(process.argv.slice(2));
