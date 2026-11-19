// Prints the browser engines a site config needs, e.g. "chromium webkit",
// so CI only downloads the browsers that will actually be used.
import fs from 'node:fs';

const profiles = JSON.parse(fs.readFileSync(new URL('../browser-profiles.json', import.meta.url)));
const config = JSON.parse(fs.readFileSync(process.env.SITE_CONFIG, 'utf8'));
const names = config.browsers || Object.keys(profiles);
const engines = new Set(names.filter((name) => profiles[name]).map((name) => profiles[name].engine));
console.log([...engines].join(' '));
