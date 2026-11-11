/**
 * The city's shaders. Positions arrive in metres east, north and up from each piece's own origin;
 * one matrix per piece puts them on the map. Faces are lit flat: the normal is worked out per pixel
 * from how the position changes across the screen, so no normals have to be stored or sent.
 */

/** Light, colour and haze shared by buildings and trees. */
const SHADING = `
uniform vec3 u_sun;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
uniform float u_opacity;
uniform float u_ambient;
uniform float u_diffuse;
// How much darker a wall is than a roof under the open sky, and the street's shade at its foot: deep
// at night, slight by day, as a city map draws its houses, soft and pale.
uniform float u_shade;

in vec3 v_pos;
in float v_w;
out vec4 fragColor;

// East, north and up seen from above land on the screen as right, up and towards the viewer, so
// this cross product points out of every face the camera can see.
vec3 faceNormal() {
  return normalize(cross(dFdx(v_pos), dFdy(v_pos)));
}

vec3 lit(vec3 base, vec3 n) {
  // Sky from above, the sun from one side, a little bounce from the ground for faces turned away.
  float sky = 1.0 - u_shade * (1.0 - n.z);
  float sun = max(dot(n, u_sun), 0.0);
  return base * (u_ambient * sky + u_diffuse * sun);
}

void finish(vec3 color) {
  // Far away the city fades into the haze over the horizon, so where it ends is never a hard line.
  color = mix(color, u_fogColor, smoothstep(u_fog.x, u_fog.y, v_w));
  fragColor = vec4(color * u_opacity, u_opacity);
}

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// As the satellite base is shown under it: a quarter less saturated, and no brighter than 0.7.
vec3 tone(vec3 c) {
  return mix(c, vec3((c.r + c.g + c.b) / 3.0), 0.25) * 0.7;
}
`

export const BUILDING_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_heightScale;
in vec3 a_pos;
in vec4 a_color;
in float a_ground;
out vec3 v_pos;
out vec4 v_color;
out float v_w;

void main() {
  v_pos = vec3(a_pos.xy, a_pos.z * u_heightScale);
  v_color = a_color;
  gl_Position = u_matrix * vec4(v_pos.xy, v_pos.z + a_ground, 1.0);
  v_w = gl_Position.w;
}
`

export const BUILDING_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_low;
uniform vec3 u_high;
uniform vec3 u_roof;
uniform float u_tagMix;
uniform float u_glass;
uniform float u_glow;
uniform vec4 u_clip;
// Sat 3D: the air photos, one layer per zoom level, finest first (see photo.ts), and where this
// piece sits in each level's window.
uniform highp sampler2DArray u_photoTex;
uniform vec4 u_photo[4];
uniform float u_photoTiles;
uniform float u_photoSize;
uniform float u_photoOn;
in vec4 v_color;
${SHADING}

// One level's photo at a point given in its finest level's tiles from the piece's origin.
// Transparent outside the level's window and in slots still waiting for their photo.
vec4 photoAt(vec2 tiles, int level) {
  vec2 at = tiles * exp2(-float(level));
  vec4 place = u_photo[level];
  vec2 inside = at - place.zw;
  if (inside.x < 0.0 || inside.y < 0.0 || inside.x >= u_photoSize || inside.y >= u_photoSize) return vec4(0.0);
  return textureLod(u_photoTex, vec3(place.xy + at / u_photoSize, float(level)), 0.0);
}

// From the coarsest level to the finest worth showing here, each laid over the last where it has a photo.
vec4 photo(vec2 tiles, int finest) {
  vec4 color = photoAt(tiles, 3);
  for (int level = 2; level >= 0; level--) {
    if (level < finest) break;
    vec4 next = photoAt(tiles, level);
    color = vec4(mix(color.rgb, next.rgb, next.a), max(color.a, next.a));
  }
  return color;
}

void main() {
  // A building across a tile edge comes in both tiles: each draws only the part on its own square.
  if (v_pos.x < u_clip.x || v_pos.y < u_clip.y || v_pos.x > u_clip.z || v_pos.y > u_clip.w) discard;
  // A model building's basement reaches below the street, which on the flat map hides nothing.
  if (v_pos.z < -0.05) discard;
  vec3 n = faceNormal();
  // A building's own colour where one is mapped, toned into the palette; else the palette by height.
  float height = v_color.a > 0.5 ? 60.0 : v_color.r * 255.0;
  vec3 base = mix(u_low, u_high, smoothstep(0.0, 120.0, height));
  if (v_color.a > 0.5) base = mix(base, v_color.rgb, u_tagMix);
  if (n.z > 0.35) base = mix(base, u_roof, 0.55);

  vec3 color = lit(base, n);
  if (u_photoOn > 0.5) {
    vec2 tiles = vec2(v_pos.x, -v_pos.y) * u_photoTiles;
    // The finest level whose pixels are no smaller than the screen's here.
    float texels = u_photoTiles * 256.0 * max(length(dFdx(v_pos.xy)), length(dFdy(v_pos.xy)));
    int finest = int(clamp(ceil(log2(max(texels, 1e-4))), 0.0, 3.0));
    // An air photo leans tall buildings away from where it was taken, so their roofs in it miss
    // their roofs here: the photo fades out above about ten storeys.
    float roof = smoothstep(0.35, 0.6, n.z) * (1.0 - smoothstep(35.0, 90.0, v_pos.z));
    if (roof > 0.0) {
      vec4 shot = photo(tiles, finest);
      // The photo has its own sun and shade, so it is lit only gently.
      color = mix(color, tone(shot.rgb) * (0.85 + 0.3 * max(dot(n, u_sun), 0.0)), roof * shot.a);
    } else {
      // Walls take a little of the colour around them, blurred, so a street sits in its photo.
      vec4 near = photo(tiles, min(finest + 2, 3));
      color = mix(color, lit(tone(near.rgb), n), 0.25 * near.a);
    }
  }
  // Darker where walls meet the ground: it reads as the street's own shade and seats each block.
  color *= mix(1.0 - 0.7 * u_shade, 1.0, smoothstep(0.0, 5.0, v_pos.z));

  if (abs(n.z) < 0.25 && v_pos.z > 0.5) {
    // Storeys and windows, drawn into the walls: a pane every 2.8 m along, a storey every 3.2 m up.
    // They fade out before they get finer than a pixel, which would only shimmer.
    vec2 along = normalize(vec2(-n.y, n.x));
    vec2 cell = vec2(dot(v_pos.xy, along) / 2.8, v_pos.z / 3.2);
    vec2 f = fract(cell);
    float pane = step(0.22, f.x) * step(f.x, 0.78) * step(0.32, f.y) * step(f.y, 0.82);
    vec2 w = fwidth(cell);
    float detail = 1.0 - smoothstep(0.25, 0.6, max(w.x, w.y));
    color = mix(color, color * u_glass, pane * detail);
    // A few lit windows at night: the same ones every time, since the hash is of the window's place.
    float lamp = step(0.955, hash(vec3(floor(cell), floor(height))));
    color += u_glow * vec3(1.0, 0.72, 0.42) * pane * lamp * detail;
  }
  finish(color);
}
`

/**
 * Rīga photographed in 3D (Sat 3D). Each corner comes set down on z = 0 by the terrain under it
 * (mesh.ts), and is raised again as far as the relief raises that terrain, plus a little clearance
 * so the relief's own drape does not show through: u_relief is the exaggeration (0 without the
 * relief) and that clearance. A piece drawn beside a closer photographed one is moved back along
 * the line from the camera (u_eye, in the piece's metres), as far as lowers it u_push.y and no
 * further than u_push.x, metres (0 for none): where both show the same ground the closer one
 * wins, and on the screen neither moves.
 */
export const MESH_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_relief;
uniform vec3 u_eye;
uniform vec2 u_push;
in vec3 a_pos;
in vec2 a_uv;
in float a_ground;
out vec3 v_pos;
out vec2 v_uv;
out float v_w;

void main() {
  v_pos = vec3(a_pos.xy, a_pos.z + u_relief.x * a_ground + u_relief.y);
  if (u_push.x > 0.0) {
    vec3 ray = normalize(v_pos - u_eye);
    v_pos += ray * min(u_push.x, u_push.y / max(-ray.z, 0.01));
  }
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(v_pos, 1.0);
  v_w = gl_Position.w;
}
`

export const MESH_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_photo;
in vec2 v_uv;
${SHADING}

void main() {
  // The photo has its sun and shade in it already: it is only toned as the air photo round it is, and hazed.
  finish(tone(texture(u_photo, v_uv).rgb));
}
`

export const TREE_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec4 a_shape;
in vec3 a_normal;
in vec3 a_tree;
in float a_ground;
out vec3 v_pos;
out float v_crown;
out float v_seed;
out vec3 v_normal;
out float v_w;

// Two numbers of its own for each tree, from where it stands: no two crowns alike.
vec2 seeds;

// A point of a one-metre tree's crown, by the angle round it and how far up it (0 to 1): a soft
// cloud, its profile egg-like, round or tall, and its side bulging in a few lobes, as on a city map.
vec3 crownAt(float angle, float up) {
  const float PI = 3.14159265;
  float widest = mix(0.85, 1.6, seeds.y);
  float width = mix(0.82, 1.22, seeds.x);
  // Never below 0: at the very top sin(π) comes out a hair under it, and its root would be no number.
  float r = 0.23 * width * sqrt(max(sin(PI * pow(up, widest)), 0.0));
  float lobes = 1.0
    + 0.14 * sin(3.0 * angle + seeds.x * 6.2832) * sin(PI * up)
    + 0.09 * sin(5.0 * angle + seeds.y * 6.2832) * sin(2.0 * PI * up + seeds.x * 3.0)
    + 0.06 * sin(2.0 * angle + seeds.y * 9.0) * sin(3.0 * PI * up);
  // The leaves' edge: soft swells, none alike from tree to tree, no sharper than the crown's own lobes.
  float rough = 1.0
    + 0.018 * sin(9.0 * angle + seeds.y * 17.0) * sin(7.0 * PI * up + seeds.x * 11.0)
    + 0.012 * sin(6.0 * angle - seeds.x * 13.0 + 9.0 * PI * up);
  float rise = 0.035 * sin(2.0 * angle + seeds.y * 6.0) * sin(PI * up);
  float k = lobes * rough;
  return vec3(cos(angle) * r * k, sin(angle) * r * k, 0.26 + 0.74 * up + rise + 0.004 * sin(9.0 * angle + seeds.x * 7.0) * sin(PI * up));
}

void main() {
  v_seed = fract(a_tree.x * 0.37 + a_tree.y * 0.61);
  seeds = vec2(v_seed, fract(a_tree.x * 0.53 + a_tree.y * 0.29 + 0.5));
  vec3 shape = a_shape.xyz;
  v_normal = a_normal;
  if (a_shape.w > 0.5) {
    // The crown comes as angle and height; its shape and its smooth normal are worked out here.
    float angle = a_shape.x;
    float up = a_shape.y;
    shape = crownAt(angle, up);
    if (up < 0.001) v_normal = vec3(0.0, 0.0, -1.0);
    else if (up > 0.999) v_normal = vec3(0.0, 0.0, 1.0);
    else {
      float u = clamp(up, 0.03, 0.97);
      vec3 p = crownAt(angle, u);
      v_normal = normalize(cross(crownAt(angle + 0.01, u) - p, crownAt(angle, u + 0.01) - p));
    }
  }
  // The unit tree is one metre tall.
  float h = a_tree.z;
  v_pos = vec3(a_tree.xy + shape.xy * h, shape.z * h);
  v_crown = a_shape.w;
  gl_Position = u_matrix * vec4(v_pos.xy, v_pos.z + a_ground, 1.0);
  v_w = gl_Position.w;
}
`

export const TREE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_leaf;
uniform vec3 u_bark;
in float v_crown;
in float v_seed;
in vec3 v_normal;
${SHADING}

void main() {
  // Smooth: the shape's own normal, not the face's.
  vec3 n = normalize(v_normal);
  // No two trees quite the same green.
  vec3 leaf = u_leaf * (0.93 + 0.14 * v_seed);
  finish(lit(v_crown > 0.5 ? leaf : u_bark, n));
}
`
