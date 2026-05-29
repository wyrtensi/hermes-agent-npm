#!/usr/bin/env node

const { runHermes } = require("../lib/python-launcher");

runHermes("hermes", process.argv.slice(2));
