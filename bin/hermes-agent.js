#!/usr/bin/env node

const { runHermes } = require("../lib/python-launcher");

runHermes(process.argv[1], process.argv.slice(2));
