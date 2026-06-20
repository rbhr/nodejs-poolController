#!/usr/bin/env node
/* Zero-dependency replacement for the old grunt-banner task.
 * Prepends the AGPL license header to source files that don't already have it.
 * Run with `npm run banner`. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const YEARS = '2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026';
const BANNER = `/*  nodejs-poolController.  An application to control pool equipment.
Copyright (C) ${YEARS}.  Russell Goldin, tagyoureit.  russ.goldin@gmail.com

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
`;

// Directories (recursive) and individual files to stamp, mirroring the old Gruntfile globs.
const DIRS = ['config', 'controller', 'logger', 'web'];
const FILES = ['app.ts'];

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const targets = [];
for (const d of DIRS) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs, targets);
}
for (const f of FILES) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) targets.push(abs);
}

let stamped = 0;
for (const file of targets) {
    const content = fs.readFileSync(file, 'utf8');
    // Tolerate a leading UTF-8 BOM when checking for an existing banner.
    const body = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
    if (body.startsWith('/*  nodejs-poolController.')) continue; // already bannered
    fs.writeFileSync(file, BANNER + content);
    stamped++;
    console.log(`banner: ${path.relative(ROOT, file)}`);
}
console.log(`Stamped ${stamped} file(s); ${targets.length - stamped} already had a banner.`);
