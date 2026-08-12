/*
 * Persisted, runtime-mutable gateway state (proxy routes + settings).
 * Seeded from proxy.js / config.js on first boot, then read from and
 * written back to state.json so changes made via the admin API survive restarts.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

function createState(defaults) {
    let data = defaults;

    if (fs.existsSync(STATE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        data = {
            routes: parsed.routes || defaults.routes,
            settings: Object.assign({}, defaults.settings, parsed.settings)
        };
    }

    const self = {
        data,
        save() {
            fs.writeFileSync(STATE_FILE, JSON.stringify(self.data, null, 2));
        }
    };

    self.save();
    return self;
}

module.exports = createState;
