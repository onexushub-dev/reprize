import appJson from '../../../app.json';

type Filter = { action: string; autoVerify?: boolean; data: { scheme: string; host: string; pathPrefix: string }[]; category: string[] };

const expo = appJson.expo;

test('shared links (/v/<code>) and partner links (/p/<code>) open the app on both platforms, on the same two domains', () => {
  const iosHosts = expo.ios.associatedDomains.map((d) => d.replace('applinks:', '')).sort();
  const filters = (expo.android as { intentFilters: Filter[] }).intentFilters;
  const verified = filters.filter((f) => f.autoVerify === true);
  // Android App Links are verified against reprizeapp.com/.well-known/assetlinks.json (the reprize-lp site), as iOS
  // checks the apple-app-site-association file there: same hosts, https only, only the link pages.
  for (const links of verified) {
    expect(links.action).toBe('VIEW');
    expect([...links.category].sort()).toEqual(['BROWSABLE', 'DEFAULT']);
    expect([...new Set(links.data.map((d) => d.host))].sort()).toEqual(iosHosts);
    for (const d of links.data) expect(d.scheme).toBe('https');
  }
  const prefixes = new Set(verified.flatMap((f) => f.data.map((d) => d.pathPrefix)));
  expect([...prefixes].sort()).toEqual(['/p/', '/v/']);
});
