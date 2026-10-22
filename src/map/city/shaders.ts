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
  float sky = 0.6 + 0.4 * n.z;
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

// As the satellite base is shown under it: a quarter less saturated, and no brighter than 0.7.
vec3 tone(vec3 c) {
  return mix(c, vec3((c.r + c.g + c.b) / 3.0), 0.25) * 0.7;
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
  color *= mix(0.72, 1.0, smoothstep(0.0, 5.0, v_pos.z));

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

export const TREE_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec4 a_shape;
in vec3 a_tree;
in float a_ground;
out vec3 v_pos;
out float v_crown;
out float v_seed;
out float v_w;

void main() {
  // The unit tree is one metre tall; its crown is as wide as the tree is tall times 0.62.
  float h = a_tree.z;
  v_pos = vec3(a_tree.xy + a_shape.xy * h, a_shape.z * h);
  v_crown = a_shape.w;
  v_seed = fract(a_tree.x * 0.37 + a_tree.y * 0.61);
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
${SHADING}

void main() {
  vec3 n = faceNormal();
  // No two trees quite the same green.
  vec3 leaf = u_leaf * (0.82 + 0.36 * v_seed);
  finish(lit(v_crown > 0.5 ? leaf : u_bark, n));
}
`
