import fs from 'fs'; import path from 'path';
const SKIP = new Set(['node_modules','.git','.next','.vercel']);
const EXT = new Set(['.ts','.tsx','.js','.jsx','.mjs','.json','.toml','.css','.sql','.yml','.yaml','.html']);
const RULES = [
  [/Sutisaree(?=[A-Z])/g, 'MishaBoutique'],
  [/www\.sutisaree\.com/g, 'www.mishaboutique.com'],
  [/sutisaree\.com/g, 'mishaboutique.com'],
  [/suti-saree-store/g, 'mishaboutique-store'],
  [/Sutisaree/g, 'Misha Boutique'],
  [/sutisaree/g, 'mishaboutique'],
];
let changed = 0;
function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!SKIP.has(f.name)) walk(p); continue; }
    if (f.name === 'package-lock.json' || f.name === 'rebrand.mjs' || !EXT.has(path.extname(f.name))) continue;
    let s = fs.readFileSync(p, 'utf8'), o = s;
    for (const [re, to] of RULES) s = s.replace(re, to);
    if (s !== o) { fs.writeFileSync(p, s); changed++; console.log('updated', p); }
  }
}
walk('.');
console.log('Total files changed:', changed);