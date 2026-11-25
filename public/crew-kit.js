import * as THREE from 'three';

const TAU = Math.PI * 2;
const mix = THREE.MathUtils.lerp;
const eased = THREE.MathUtils.smoothstep;
const HEM = -0.72;
const TOP = 0.94;
const SLICES = 64;

function geometry(points, indices, uv, colors) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// The neckline, two armholes and the piping atlas use the same pattern.
function cut(angle) {
  const front = Math.cos(angle);
  const across = (Math.abs(angle) - Math.PI / 2) / (Math.PI / 4);
  const opening = Math.sqrt(Math.max(0, 1 - across * across));
  return {
    neck: TOP - (front > 0 ? 0.62 : 0.34) * front * front,
    under: 0.27 - 0.32 * opening,
    shoulder: 0.27 + 0.51 * opening,
  };
}

function torsoRadius(y) {
  return Math.sqrt(Math.max(0, 1 - y * y)) * (1 + 0.16 * (1 - eased(y, -0.9, 0.3)));
}

function singlet() {
  const points = [], indices = [], uv = [], normals = [];
  const add = (angle, y) => {
    const radius = torsoRadius(y);
    const dr = (torsoRadius(y + 0.001) - torsoRadius(y - 0.001)) / 0.002;
    const nx = Math.sin(angle) / 0.575, ny = -dr / 0.60, nz = Math.cos(angle) / 0.516;
    const len = Math.hypot(nx, ny, nz);
    points.push(0.575 * radius * Math.sin(angle), 0.60 * y, 0.516 * radius * Math.cos(angle));
    normals.push(nx / len, ny / len, nz / len);
    uv.push(angle / TAU + 0.5, (y - HEM) / (TOP - HEM));
    return points.length / 3 - 1;
  };
  let prior;
  for (let col = 0; col <= SLICES; col++) {
    const angle = col / SLICES * TAU - Math.PI, p = cut(angle), column = [];
    for (let k = 0; k <= 8; k++) column.push(add(angle, mix(HEM, p.under, k / 8)));
    column.push(p.under === p.shoulder ? column[8] : add(angle, p.shoulder));
    for (let k = 1; k <= 7; k++) column.push(add(angle, mix(p.shoulder, p.neck, k / 7)));
    if (prior) {
      for (let row = 0; row < column.length - 1; row++) {
        if (row === 8) continue;
        indices.push(prior[row], column[row], prior[row + 1], column[row], column[row + 1], prior[row + 1]);
      }
    }
    prior = column;
  }
  const geo = geometry(points, indices, uv);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

export const jerseyGeometry = singlet();

const knit = new THREE.TextureLoader().load(new URL('./art/jersey-knit.webp', import.meta.url).href);
knit.wrapS = knit.wrapT = THREE.RepeatWrapping;
knit.colorSpace = THREE.NoColorSpace;
knit.repeat.set(8, 3);
knit.anisotropy = 4;

export function jerseySkin(skin, initialPrint) {
  const canvas = document.createElement('canvas');
  const w = canvas.width = 768, h = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const py = y => h * (1 - (y - HEM) / (TOP - HEM));
  const outline = skin.shirt === 0xf2efe8 ? '#9c5651' : '#f6e6c7';
  const path = (field, a, b, width, tint) => {
    ctx.beginPath();
    for (let k = 0; k <= 128; k++) {
      const u = mix(a, b, k / 128), y = py(cut((u - 0.5) * TAU)[field]);
      if (!k) ctx.moveTo(u * w, y); else ctx.lineTo(u * w, y);
    }
    ctx.strokeStyle = tint; ctx.lineWidth = width; ctx.stroke();
  };
  ctx.fillStyle = '#' + skin.shirt.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, w, h);
  for (const center of [.25, .75]) {
    const x = center * w;
    ctx.beginPath(); ctx.moveTo(x - 51, 64); ctx.lineTo(x + 51, 64);
    ctx.bezierCurveTo(x + 48, 111, x + 16, 194, x + 24, h);
    ctx.lineTo(x - 24, h); ctx.bezierCurveTo(x - 16, 194, x - 48, 111, x - 51, 64);
    ctx.fillStyle = 'rgba(23,37,52,.21)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,229,.15)'; ctx.lineWidth = 1.6; ctx.stroke();
    for (const field of ['under','shoulder']) {
      path(field, center - .125, center + .125, 8, 'rgba(26,33,45,.36)');
      path(field, center - .125, center + .125, 4.8, outline);
    }
  }
  path('neck', 0, 1, 12, 'rgba(26,33,45,.32)');
  path('neck', 0, 1, 7, outline);
  ctx.fillStyle = 'rgba(28,35,44,.22)'; ctx.fillRect(0, h - 9, w, 9);
  ctx.fillStyle = 'rgba(255,248,228,.40)'; ctx.fillRect(0, h - 8, w, 1.5);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map, bumpMap: knit, bumpScale: 0.002, roughness: 0.91 });
  const blank = document.createElement('canvas');
  blank.width = w; blank.height = h; blank.getContext('2d').drawImage(canvas, 0, 0);
  const setPrint = image => {
    ctx.drawImage(blank, 0, 0);
    const stamp = (u, y, width, height) => ctx.drawImage(image, w * u - width / 2, py(y) - height / 2, width, height);
    stamp(.514, -.11, 66, 78);
    for (const u of [0, 1]) stamp(u, .15, 75, 84);
    map.needsUpdate = true;
  };
  setPrint(initialPrint);
  return { material, setPrint };
}

// Contour stations in ascending height. The hand and the foot are part of each soft limb.
function loft(stations, segments = 24, warp) {
  const p = [], uv = [], indices = [], colors = [];
  for (let j = 0; j < stations.length; j++) {
    const [cy, cx, cz, rx, rz] = stations[j];
    for (let i = 0; i <= segments; i++) {
      const a = i * TAU / segments;
      const v = new THREE.Vector3(cx + rx * Math.sin(a), cy, cz + rz * Math.cos(a));
      const shade = new THREE.Color(0xffffff);
      if (warp) warp(v, shade, j, a);
      p.push(v.x, v.y, v.z); uv.push(i / segments, j / (stations.length - 1));
      colors.push(shade.r, shade.g, shade.b);
      if (j && i) {
        const b = j * (segments + 1) + i;
        indices.push(b - segments - 2, b - segments - 1, b - 1, b - segments - 1, b, b - 1);
      }
    }
  }
  const geo = geometry(p, indices, uv, warp ? colors : undefined);
  const normal = geo.attributes.normal, v = new THREE.Vector3(), last = new THREE.Vector3();
  for (let j = 0; j < stations.length; j++) {
    const a = j * (segments + 1), b = a + segments;
    v.fromBufferAttribute(normal, a).add(last.fromBufferAttribute(normal, b)).normalize();
    normal.setXYZ(a, v.x, v.y, v.z); normal.setXYZ(b, v.x, v.y, v.z);
  }
  return geo;
}

export const arms = [-1, 1].map(s => loft([
  [-.698,s*.146,.102,.002,.002], [-.688,s*.146,.106,.059,.071],
  [-.653,s*.147,.105,.100,.122], [-.608,s*.147,.087,.112,.130],
  [-.552,s*.146,.066,.108,.118], [-.498,s*.147,.050,.113,.123],
  [-.417,s*.139,.032,.124,.132], [-.34,s*.135,.012,.119,.124], [-.28,s*.131,.004,.128,.133],
  [-.19,s*.109,.003,.141,.149], [-.095,s*.078,.006,.157,.166],
  [-.020,s*.038,0,.149,.149], [.040,-s*.003,-.005,.115,.119],
  [.076,-s*.032,-.005,.066,.070], [.088,-s*.047,-.008,.001,.001],
], 20));

export const leg = loft([
  [-.398,0,.420,.002,.002], [-.39,0,.420,.071,.087], [-.364,0,.426,.125,.148],
  [-.320,0,.416,.148,.177], [-.270,0,.389,.147,.166], [-.210,0,.349,.137,.145],
  [-.144,0,.291,.145,.158], [-.06,0,.204,.164,.169], [.025,0,.126,.153,.149],
  [.075,0,.086,.095,.087], [.09,0,.068,.002,.002],
], 22);

export const shortLeg = loft([
  [-.163,0,.302,.139,.153], [-.15,0,.297,.153,.167], [-.133,0,.287,.161,.174],
  [-.103,0,.259,.166,.171], [-.052,0,.20,.183,.188], [.022,0,.12,.178,.172], [.085,0,.07,.108,.102],
], 24, (v,c,j) => c.setScalar(j === 1 ? .69 : 1));

export const shorts = loft([
  [-.244,0,-.010,.002,.002], [-.223,0,-.010,.226,.253], [-.176,0,-.005,.377,.389],
  [-.095,0,.005,.468,.495], [.020,0,.024,.511,.532], [.105,0,.037,.51,.511],
  [.165,0,.048,.486,.475], [.207,0,.050,.450,.436], [.229,0,.052,.429,.41], [.237,0,.052,.405,.391],
], 40, (v,c,j)=>{
  if (v.z < 0) v.z *= .86;
  c.setScalar(j === 7 ? .72 : 1);
});

const cream = new THREE.Color('#f0d5ac');
const navy = new THREE.Color('#264665');
const indigo = new THREE.Color('#395f84');
const band = new THREE.Color('#bd403a');
const cotton = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .90 });
const wool = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .97, bumpMap: knit, bumpScale: .003 });
const lacquer = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .29, metalness: .12 });

export const kitMaterials = { cotton, wool, lacquer };
export const cap = loft([
  [-.037,0,0,.337,.348], [-.025,0,.004,.350,.358], [.001,0,.004,.355,.361],
  [.024,0,0,.350,.357], [.078,0,-.009,.333,.345], [.15,0,-.019,.293,.304],
  [.204,0,-.030,.231,.235], [.238,0,-.037,.146,.151], [.253,0,-.04,.002,.002],
], 48, (v, c, j, a) => {
  const seam = Math.pow(.5 + .5 * Math.cos(a * 6), 12);
  v.y -= .009 * seam * Math.sin(Math.PI * j / 8);
  c.setScalar((j < 2 ? .65 : 1) - .18 * seam);
});

// A rounded bill with a curved leading edge, a bound rim and a shaded underside.
export const bill = (() => {
  const p = [], uv = [], colors = [], indices = [];
  const sections = [[.001,-.017,.62], [.75,-.017,.62], [.98,-.014,.6],
    [1,-.009,.7], [1,0,.68], [.976,.006,.83], [.936,.009,.93], [.908,.009,.78], [.885,.010,1], [.001,.013,1]];
  for (let j = 0; j < sections.length; j++) for (let i = 0; i <= 48; i++) {
    const a = TAU * i / 48, [r,h,value] = sections[j];
    const width = .322 * r * Math.sin(a), z = r * Math.cos(a);
    p.push(width, .024 + h - .34 * width * width - .028 * z, .303 + .247 * z);
    colors.push(value,value,value); uv.push(.5 + width, .5 + .45 * z);
    if (i && j) {
      const b = j * 49 + i;
      indices.push(b - 50, b - 49, b - 1, b - 49, b, b - 1);
    }
  }
  return geometry(p, indices, uv, colors);
})();

export const beanie = loft([
  [-.073,0,-.006,.335,.355], [-.058,0,-.009,.374,.390], [-.041,0,-.009,.382,.398],
  [-.001,0,-.012,.383,.398], [.033,-.001,-.016,.374,.388], [.044,-.002,-.020,.358,.377],
  [.059,-.002,-.023,.345,.361], [.124,-.009,-.039,.335,.346], [.196,-.024,-.073,.305,.309],
  [.253,-.049,-.106,.259,.259], [.295,-.074,-.154,.193,.192], [.318,-.095,-.191,.126,.123],
  [.322,-.115,-.216,.055,.056], [.320,-.13,-.226,.002,.002],
], 80, (v,c,j,a) => {
  const rib = .5 + .5 * Math.cos(20 * a), folds = .5 + .5 * Math.cos(6 * a + j * .28);
  const crown = 1 - eased(j, 9, 13);
  const depth = (j <= 5 ? .008 * rib : .014 * folds) * crown;
  v.x += depth * Math.sin(a); v.z += depth * Math.cos(a);
  v.y += (.015 * Math.sin(a - .3) + .007 * Math.cos(3*a)) * crown;
  c.copy(j <= 5 ? navy : indigo).multiplyScalar(j < 6 ? .73 + .27 * rib : .86 + .14 * folds);
  if (j === 2) c.lerp(cream,.50);
});

export const bandana = loft([
  [-.041,0,0,.330,.341], [-.034,0,.003,.347,.354], [-.014,0,.001,.350,.357],
  [.010,0,0,.344,.352], [.020,0,-.003,.349,.351], [.043,0,-.008,.337,.345],
  [.102,-.009,-.018,.311,.316], [.152,-.020,-.030,.268,.276],
  [.193,-.036,-.048,.192,.196], [.214,-.050,-.070,.112,.116], [.218,-.069,-.082,.002,.002],
], 64, (v,c,j,a) => {
  const crown = 1 - eased(j, 6, 10);
  v.y += (.024*Math.sin(a+.1) - .016*Math.cos(a*2-.3)) * crown;
  v.z += .008*Math.cos(5*a+j*.25)*Math.cos(a) * crown;
  c.copy(band).multiplyScalar(j===3?.65:.90+.1*Math.cos(4*a+.35*j));
  if(j===1 || (j===4 && Math.cos(a*20)>.5)) c.lerp(cream,j===1?.86:.70);
});

export const bandanaTail = loft([
  [-.30,.095,-.050,.002,.002], [-.26,.078,-.044,.029,.012], [-.19,.057,-.040,.046,.017],
  [-.12,.030,-.015,.043,.012], [-.055,.002,.003,.032,.014], [-.005,0,0,.017,.012],
], 12, (v,c,j,a) => {
  c.copy(band).multiplyScalar(.75+.25*Math.cos(a));
  if(j===1) c.lerp(cream,.7);
});

export const sunglasses = (() => {
  const p = [], uv = [], colors = [], indices = [];
  const frame = new THREE.Color('#26303d'), edge = new THREE.Color('#39424a');
  const ocean = new THREE.Color('#244459'), reflection = new THREE.Color('#689094'), dark = new THREE.Color('#172a3a');
  function component(rows, segments, fn) {
    const first = p.length / 3;
    for (let j=0; j<rows; j++) for(let i=0;i<=segments;i++) {
      const [x,y,z,c] = fn(j, TAU*i/segments);
      p.push(x,y,z); colors.push(c.r,c.g,c.b); uv.push(i/segments,j/(rows-1));
      if (i && j) {
        const b=first+j*(segments+1)+i;
        indices.push(b-segments-2,b-segments-1,b-1,b-segments-1,b,b-1);
      }
    }
  }
  for(const side of [-1,1]) {
    const rings = [[.001,-.025],[.93,-.024],[1,-.013],[1.016,.001],[.982,.013],[.858,.016],[.821,.007],[.74,.013],[.52,.021],[.27,.025],[.001,.027]];
    component(rings.length,40,(j,a)=>{
      const [r,d]=rings[j], cx=Math.cos(a), sy=Math.sin(a);
      const xx = Math.sign(cx)*Math.abs(cx)**.70 * (.96+.09*sy);
      const yy = Math.sign(sy)*Math.abs(sy)**.78;
      const x = .199*side + .168*r*xx, y=.355+.112*r*yy+.013*side*r*xx;
      const z = .344 + d - .23*x*x - .077*(x*side-.19);
      const highlight = eased(r*(yy-.52*xx), -.12, .36);
      const c = j>5 ? dark.clone().lerp(ocean,.55+.4*yy*r).lerp(reflection,.55*highlight) : (j===4?edge:frame);
      return [x,y,z,c];
    });
  }
  function tube(nodes, radius) {
    const curve = new THREE.CatmullRomCurve3(nodes.map(p=>new THREE.Vector3(...p)));
    const tube = new THREE.TubeGeometry(curve, 10, radius, 7, false);
    const offset = p.length / 3, pos = tube.attributes.position;
    for(let i=0;i<pos.count;i++) {p.push(pos.getX(i),pos.getY(i),pos.getZ(i)); colors.push(frame.r,frame.g,frame.b); uv.push(0,0);}
    for(const i of tube.index.array)indices.push(i+offset);
    tube.dispose();
  }
  tube([[-.068,.388,.353],[-.030,.394,.365],[0,.392,.367],[.030,.394,.365],[.068,.388,.353]],.013);
  for(const s of [-1,1]) tube([[s*.343,.388,.306],[s*.372,.386,.255],[s*.384,.386,.150],[s*.401,.385,.019],[s*.395,.363,-.074]],.014);
  return geometry(p,indices,uv,colors);
})();
