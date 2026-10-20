// Common-area popup (artifact comment): every photo group configured for a common-area type matches real photos
// from the launch material, and areas without photos are not given any (no invented imagery).
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { load, DATA } = require('./harness.js');
const App = load(), dev = App.config.DEVELOPMENTS[0];
const imgs = JSON.parse(fs.readFileSync(path.join(DATA, 'img_list.json'), 'utf8'));
test('poiImages: each configured title matches at least one launch photo', () => {
  const d = dev; assert.ok(d, 'development config');
  for (const [type, titles] of Object.entries(d.poiImages)) {
    if (type === 'note') continue;
    assert.ok(d.pois.some(p => p.type === type), `type ${type} exists in pois`);
    for (const t of titles) assert.ok(imgs.some(im => im.t.toLowerCase().startsWith(t.toLowerCase())), `${type}: ${t}`);
  }
});
test('poiImages: technical areas have no photos and the note says positions need confirmation', () => {
  for (const t of ['PUMP_STATION', 'PARKING', 'ADMIN', 'PARK']) assert.ok(!dev.poiImages[t], t);
  assert.match(dev.poiImages.note, /confirmad/);
});
