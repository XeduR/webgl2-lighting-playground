/*
    GLSL Shader Sources - ADDITIVE COLORED LIGHT MODEL

    Key concept: Light through translucent objects becomes COLORED LIGHT that ADDS together.

    - Red glass creates RED LIGHT
    - Green glass creates GREEN LIGHT
    - Red + Green light = YELLOW (additive mixing, BRIGHTER)

    Shadow behavior:
    - opacity = 0: Invisible, not rendered
    - 0 < opacity < 1: Light passes through, tinted by object color (NO shadow, colored light)
    - opacity = 1: Blocks ALL light (true shadow from depth map)

    Edge handling:
    - Transmission map uses alpha channel to track coverage
    - Areas with no coverage (alpha=0) return full WHITE light
    - Soft shadow sampling blends based on coverage for smooth colored edges
*/

export const COMMON_GLSL = `
#define PI 3.14159265359

vec3 linearToSRGB(vec3 color) {
    vec3 lo = color * 12.92;
    vec3 hi = pow(color, vec3(1.0/2.4)) * 1.055 - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), color));
}
`;

// Depth-only shadow shaders (for opaque objects)
export const SHADOW_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uModelMatrix;
uniform mat4 uLightMatrix;
void main() {
    gl_Position = uLightMatrix * uModelMatrix * vec4(aPosition, 1.0);
}
`;

export const SHADOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
void main() {}
`;

// Point light shadow shaders
export const POINT_SHADOW_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uModelMatrix;
uniform mat4 uLightViewMatrix;
uniform mat4 uLightProjMatrix;
out vec4 vFragPos;
void main() {
    vFragPos = uModelMatrix * vec4(aPosition, 1.0);
    gl_Position = uLightProjMatrix * uLightViewMatrix * vFragPos;
}
`;

export const POINT_SHADOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uLightPosition;
uniform float uFarPlane;
in vec4 vFragPos;
out float fragDepth;
void main() {
    fragDepth = length(vFragPos.xyz - uLightPosition) / uFarPlane;
}
`;

// Transmission shader - Colored light with attenuation
// RGB = colored light tint, A = transmittance (how much light passes)
// Uses multiplicative blending for alpha to properly accumulate attenuation
export const TRANSMISSION_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uModelMatrix;
uniform mat4 uLightMatrix;
out float vDepth;
void main() {
    gl_Position = uLightMatrix * uModelMatrix * vec4(aPosition, 1.0);
    vDepth = gl_Position.z / gl_Position.w * 0.5 + 0.5;
}
`;

export const TRANSMISSION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uThickness;
in float vDepth;
out vec4 fragColor;
void main() {
    // Skip fully transparent objects
    if (uOpacity <= 0.001) {
        discard;
    }

    // TRANSMISSION MODEL:
    // transmittance = how much light passes (0 = fully blocked, 1 = fully passes)
    // At high opacity (e.g., 0.99), almost no light passes (transmittance = 0.01)

    float transmittance = 1.0 - uOpacity;

    // The color tint of transmitted light
    vec3 tintedColor = mix(vec3(1.0), uColor, uThickness);

    // RGB: colored light (tint * transmittance gives the colored contribution)
    // Alpha: transmittance (used for proper attenuation accumulation)
    fragColor = vec4(tintedColor * transmittance, transmittance);
}
`;

// Point light transmission shader
export const POINT_TRANSMISSION_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uModelMatrix;
uniform mat4 uLightViewMatrix;
uniform mat4 uLightProjMatrix;
void main() {
    gl_Position = uLightProjMatrix * uLightViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
}
`;

export const POINT_TRANSMISSION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uThickness;
out vec4 fragColor;
void main() {
    if (uOpacity <= 0.001) {
        discard;
    }

    float transmittance = 1.0 - uOpacity;
    vec3 tintedColor = mix(vec3(1.0), uColor, uThickness);

    fragColor = vec4(tintedColor * transmittance, transmittance);
}
`;

// Main scene vertex shader
export const MAIN_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
uniform mat4 uShadowMatrix3;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec4 vPosFromLight0;
out vec4 vPosFromLight1;
out vec4 vPosFromLight2;
out vec4 vPosFromLight3;

void main() {
    vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);

    vPosFromLight0 = uShadowMatrix0 * worldPos;
    vPosFromLight1 = uShadowMatrix1 * worldPos;
    vPosFromLight2 = uShadowMatrix2 * worldPos;
    vPosFromLight3 = uShadowMatrix3 * worldPos;

    gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
}
`;

// Main scene fragment shader with ADDITIVE colored light model
export const MAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

${COMMON_GLSL}

uniform vec3 uColor;
uniform float uOpacity;
uniform float uSpecular;
uniform float uRoughness;
uniform vec3 uCameraPosition;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;

uniform int uNumLights;
#define MAX_LIGHTS 16
uniform int uLightTypes[MAX_LIGHTS];
uniform vec3 uLightPositions[MAX_LIGHTS];
uniform vec3 uLightDirections[MAX_LIGHTS];
uniform vec3 uLightColors[MAX_LIGHTS];
uniform float uLightIntensities[MAX_LIGHTS];
uniform float uLightRanges[MAX_LIGHTS];
uniform float uLightInnerAngles[MAX_LIGHTS];
uniform float uLightOuterAngles[MAX_LIGHTS];

// Shadow maps (opaque objects only)
uniform int uNumDirSpotShadows;
uniform sampler2DShadow uShadowMap0;
uniform sampler2DShadow uShadowMap1;
uniform sampler2DShadow uShadowMap2;
uniform sampler2DShadow uShadowMap3;
uniform float uShadowBias[4];
uniform int uShadowLightIndex[4];

// Transmission maps (ADDITIVE colored light from translucent objects)
uniform bool uTransmissionEnabled;
uniform sampler2D uTransmissionMap0;
uniform sampler2D uTransmissionMap1;
uniform sampler2D uTransmissionMap2;
uniform sampler2D uTransmissionMap3;
// Transmission depth maps (for depth-aware filtering)
uniform sampler2D uTransmissionDepth0;
uniform sampler2D uTransmissionDepth1;
uniform sampler2D uTransmissionDepth2;
uniform sampler2D uTransmissionDepth3;

// Point light shadows
uniform int uNumPointShadows;
uniform sampler2D uPointShadowMap0;
uniform sampler2D uPointShadowMap1;
uniform float uPointFarPlane[2];
uniform vec3 uPointShadowPos[2];
uniform int uPointShadowLightIndex[2];

// Point light transmission
uniform sampler2D uPointTransmissionMap0;
uniform sampler2D uPointTransmissionMap1;

uniform bool uSoftShadows;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec4 vPosFromLight0;
in vec4 vPosFromLight1;
in vec4 vPosFromLight2;
in vec4 vPosFromLight3;

out vec4 fragColor;

// Sample OPAQUE shadow map with slope-scaled bias
float sampleOpaqueShadow(sampler2DShadow shadowMap, vec3 projCoords, float bias, vec3 N, vec3 L) {
    // Out of shadow frustum = fully lit
    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
        projCoords.y < 0.0 || projCoords.y > 1.0 ||
        projCoords.z < 0.0 || projCoords.z > 1.0)
        return 1.0;

    // Simple slope-scaled bias: increase bias for surfaces at grazing angles
    float NdotL = max(dot(N, L), 0.0);
    float slopeFactor = 1.0 - NdotL; // 0 when facing light, 1 at grazing angle
    float totalBias = bias * (1.0 + slopeFactor * 2.0);

    if (uSoftShadows) {
        vec2 texelSize = 1.0 / vec2(textureSize(shadowMap, 0));
        float shadow = 0.0;
        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                shadow += texture(shadowMap, vec3(projCoords.xy + vec2(x,y) * texelSize, projCoords.z - totalBias));
            }
        }
        return shadow / 9.0;
    }
    return texture(shadowMap, vec3(projCoords.xy, projCoords.z - totalBias));
}

// Sample transmission map - returns light multiplier with color tinting
// RGB contains accumulated colored light, Alpha contains total transmittance
// This unified model handles both translucent (colored) and opaque (black) shadows
vec3 sampleTransmission(int idx, vec3 projCoords, float fragDepth) {
    // Out of bounds = full white light (no filtering)
    if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
        projCoords.y < 0.0 || projCoords.y > 1.0)
        return vec3(1.0);

    // Sample transmission depth to check if any object is in front of this fragment
    float transDepth;
    if (idx == 0) transDepth = texture(uTransmissionDepth0, projCoords.xy).r;
    else if (idx == 1) transDepth = texture(uTransmissionDepth1, projCoords.xy).r;
    else if (idx == 2) transDepth = texture(uTransmissionDepth2, projCoords.xy).r;
    else transDepth = texture(uTransmissionDepth3, projCoords.xy).r;

    // If no object is closer to the light than this fragment, return white (full light)
    if (transDepth >= fragDepth - 0.001) {
        return vec3(1.0);
    }

    vec4 sample0;
    if (idx == 0) sample0 = texture(uTransmissionMap0, projCoords.xy);
    else if (idx == 1) sample0 = texture(uTransmissionMap1, projCoords.xy);
    else if (idx == 2) sample0 = texture(uTransmissionMap2, projCoords.xy);
    else sample0 = texture(uTransmissionMap3, projCoords.xy);

    // Alpha = 1 means clear (no objects wrote here), return white
    if (sample0.a > 0.999) {
        return vec3(1.0);
    }

    if (uSoftShadows) {
        vec2 texelSize;
        if (idx == 0) texelSize = 1.0 / vec2(textureSize(uTransmissionMap0, 0));
        else if (idx == 1) texelSize = 1.0 / vec2(textureSize(uTransmissionMap1, 0));
        else if (idx == 2) texelSize = 1.0 / vec2(textureSize(uTransmissionMap2, 0));
        else texelSize = 1.0 / vec2(textureSize(uTransmissionMap3, 0));

        vec3 colorSum = vec3(0.0);
        float alphaSum = 0.0;

        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                vec2 sampleUV = projCoords.xy + vec2(x, y) * texelSize;

                // Only count samples where a translucent object is in front of this fragment
                float sampleDepth;
                if (idx == 0) sampleDepth = texture(uTransmissionDepth0, sampleUV).r;
                else if (idx == 1) sampleDepth = texture(uTransmissionDepth1, sampleUV).r;
                else if (idx == 2) sampleDepth = texture(uTransmissionDepth2, sampleUV).r;
                else sampleDepth = texture(uTransmissionDepth3, sampleUV).r;

                if (sampleDepth < fragDepth - 0.001) {
                    vec4 texSample;
                    if (idx == 0) texSample = texture(uTransmissionMap0, sampleUV);
                    else if (idx == 1) texSample = texture(uTransmissionMap1, sampleUV);
                    else if (idx == 2) texSample = texture(uTransmissionMap2, sampleUV);
                    else texSample = texture(uTransmissionMap3, sampleUV);

                    colorSum += texSample.rgb;
                    alphaSum += texSample.a;
                } else {
                    // No shadow here
                    colorSum += vec3(1.0);
                    alphaSum += 1.0;
                }
            }
        }

        vec3 avgColor = colorSum / 9.0;
        float avgAlpha = alphaSum / 9.0;

        // Combine: colored light + remaining white light based on transmittance
        // avgColor already has the colored contribution scaled by transmittance
        // avgAlpha is the remaining transmittance (uncolored light that passes)
        return avgColor + vec3(avgAlpha) * max(0.0, 1.0 - (avgColor.r + avgColor.g + avgColor.b) / 3.0);
    }

    // Non-soft shadow: use center sample directly
    // RGB = colored light contribution (already scaled by transmittance)
    // Alpha = remaining transmittance
    // Final = colored + white * alpha (but avoid double-counting)
    vec3 coloredLight = sample0.rgb;
    float transmittance = sample0.a;

    // Simple combination: the colored light plus remaining white light
    return coloredLight + vec3(transmittance);
}

// Sample point light shadow from cubemap atlas
float samplePointShadow(int idx, vec3 fragToLight, float farPlane, vec3 N) {
    float dist = length(fragToLight);
    vec3 dir = fragToLight / dist;

    vec3 absDir = abs(dir);
    float maxAxis = max(absDir.x, max(absDir.y, absDir.z));

    vec2 uv;
    int face;
    if (absDir.x >= maxAxis - 0.001) {
        face = dir.x > 0.0 ? 0 : 1;
        uv = dir.x > 0.0 ? vec2(-dir.z, -dir.y) : vec2(dir.z, -dir.y);
        uv /= absDir.x;
    } else if (absDir.y >= maxAxis - 0.001) {
        face = dir.y > 0.0 ? 2 : 3;
        uv = dir.y > 0.0 ? vec2(dir.x, dir.z) : vec2(dir.x, -dir.z);
        uv /= absDir.y;
    } else {
        face = dir.z > 0.0 ? 4 : 5;
        uv = dir.z > 0.0 ? vec2(dir.x, -dir.y) : vec2(-dir.x, -dir.y);
        uv /= absDir.z;
    }

    uv = uv * 0.5 + 0.5;

    uv = clamp(uv, 0.0, 1.0);

    // Compute atlas tile bounds for this face to clamp PCF samples within the tile
    float tileX = float(face % 3) / 3.0;
    float tileY = float(face / 3) / 2.0;
    uv = vec2(tileX + uv.x / 3.0, tileY + uv.y / 2.0);
    vec2 tileBoundsMin = vec2(tileX, tileY);
    vec2 tileBoundsMax = vec2(tileX + 1.0 / 3.0, tileY + 0.5);

    // Slope-scaled bias: increase for grazing angles on curved surfaces
    vec3 L = -dir;
    float NdotL = max(dot(N, L), 0.0);
    float slopeFactor = 1.0 - NdotL;
    float totalBias = 0.05 * (1.0 + slopeFactor * 2.0);

    if (uSoftShadows) {
        // 3x3 PCF in atlas UV space, clamped to face tile bounds
        vec2 atlasSize;
        if (idx == 0) atlasSize = vec2(textureSize(uPointShadowMap0, 0));
        else atlasSize = vec2(textureSize(uPointShadowMap1, 0));
        vec2 texelSize = 1.0 / atlasSize;

        float shadow = 0.0;
        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                vec2 sampleUV = clamp(uv + vec2(x, y) * texelSize, tileBoundsMin, tileBoundsMax);
                float sampleDepth;
                if (idx == 0) sampleDepth = texture(uPointShadowMap0, sampleUV).r * farPlane;
                else sampleDepth = texture(uPointShadowMap1, sampleUV).r * farPlane;
                shadow += dist - totalBias > sampleDepth ? 0.0 : 1.0;
            }
        }
        return shadow / 9.0;
    }

    float closestDepth;
    if (idx == 0) closestDepth = texture(uPointShadowMap0, uv).r * farPlane;
    else closestDepth = texture(uPointShadowMap1, uv).r * farPlane;

    return dist - totalBias > closestDepth ? 0.0 : 1.0;
}

// Sample point light transmission with coverage-aware blending
vec3 samplePointTransmission(int idx, vec3 fragToLight, float farPlane) {
    float dist = length(fragToLight);
    vec3 dir = fragToLight / dist;

    vec3 absDir = abs(dir);
    float maxAxis = max(absDir.x, max(absDir.y, absDir.z));

    vec2 uv;
    int face;
    if (absDir.x >= maxAxis - 0.001) {
        face = dir.x > 0.0 ? 0 : 1;
        uv = dir.x > 0.0 ? vec2(-dir.z, -dir.y) : vec2(dir.z, -dir.y);
        uv /= absDir.x;
    } else if (absDir.y >= maxAxis - 0.001) {
        face = dir.y > 0.0 ? 2 : 3;
        uv = dir.y > 0.0 ? vec2(dir.x, dir.z) : vec2(dir.x, -dir.z);
        uv /= absDir.y;
    } else {
        face = dir.z > 0.0 ? 4 : 5;
        uv = dir.z > 0.0 ? vec2(dir.x, -dir.y) : vec2(-dir.x, -dir.y);
        uv /= absDir.z;
    }

    uv = uv * 0.5 + 0.5;

    // Add padding to avoid sampling across face boundaries (fixes seam artifacts)
    float padding = 0.002;
    uv = clamp(uv, padding, 1.0 - padding);

    uv = vec2(float(face % 3) / 3.0 + uv.x / 3.0, float(face / 3) / 2.0 + uv.y / 2.0);

    vec4 texSample;
    if (idx == 0) texSample = texture(uPointTransmissionMap0, uv);
    else texSample = texture(uPointTransmissionMap1, uv);

    // Alpha = 1 means no objects (cleared to 1), return white
    if (texSample.a > 0.999) {
        return vec3(1.0);
    }

    // Combine colored light with remaining transmittance
    vec3 coloredLight = texSample.rgb;
    float transmittance = texSample.a;
    return coloredLight + vec3(transmittance);
}

vec3 blinnPhong(vec3 N, vec3 L, vec3 V, vec3 lightColor, float intensity) {
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = uColor * NdotL;

    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float shininess = mix(8.0, 128.0, 1.0 - uRoughness);
    float spec = pow(NdotH, shininess) * uSpecular;

    return (diffuse + vec3(spec)) * lightColor * intensity;
}

float getAttenuation(int type, int idx, vec3 lightToFrag) {
    if (type == 0) return 1.0; // Directional

    float dist = length(lightToFrag);
    float range = uLightRanges[idx];
    if (dist >= range) return 0.0;

    float atten = 1.0 - smoothstep(range * 0.5, range, dist);
    atten *= 1.0 / (1.0 + dist * 0.1 + dist * dist * 0.01);

    if (type == 2) { // Spot
        float theta = dot(normalize(lightToFrag), uLightDirections[idx]);
        float inner = cos(uLightInnerAngles[idx]);
        float outer = cos(uLightOuterAngles[idx]);
        atten *= clamp((theta - outer) / (inner - outer), 0.0, 1.0);
    }

    return atten;
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPosition - vWorldPosition);

    // Ambient lighting
    vec3 totalLight = uAmbientColor * uAmbientIntensity * uColor;

    for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= uNumLights) break;

        int lightType = uLightTypes[i];
        vec3 L, lightToFrag;

        if (lightType == 0) {
            // Directional lights have no position; attenuation returns 1.0 immediately for type 0
            L = -uLightDirections[i];
            lightToFrag = vec3(0.0);
        } else {
            lightToFrag = vWorldPosition - uLightPositions[i];
            L = -normalize(lightToFrag);
        }

        float atten = getAttenuation(lightType, i, lightToFrag);
        if (atten <= 0.0) continue;

        // SHADOW AND TRANSMISSION CALCULATION
        float opaqueShadow = 1.0;
        vec3 transmittedLight = vec3(1.0); // WHITE = full unfiltered light

        // Check directional/spot shadows
        for (int s = 0; s < 4; s++) {
            if (s >= uNumDirSpotShadows) break;
            if (uShadowLightIndex[s] != i) continue;

            vec4 posFromLight;
            if (s == 0) posFromLight = vPosFromLight0;
            else if (s == 1) posFromLight = vPosFromLight1;
            else if (s == 2) posFromLight = vPosFromLight2;
            else posFromLight = vPosFromLight3;

            vec3 projCoords = posFromLight.xyz / posFromLight.w * 0.5 + 0.5;
            float fragDepth = projCoords.z; // Fragment depth from light's perspective

            if (s == 0) opaqueShadow = sampleOpaqueShadow(uShadowMap0, projCoords, uShadowBias[s], N, L);
            else if (s == 1) opaqueShadow = sampleOpaqueShadow(uShadowMap1, projCoords, uShadowBias[s], N, L);
            else if (s == 2) opaqueShadow = sampleOpaqueShadow(uShadowMap2, projCoords, uShadowBias[s], N, L);
            else opaqueShadow = sampleOpaqueShadow(uShadowMap3, projCoords, uShadowBias[s], N, L);

            if (uTransmissionEnabled) {
                transmittedLight = sampleTransmission(s, projCoords, fragDepth);
            }
            break;
        }

        // Check point light shadows
        for (int p = 0; p < 2; p++) {
            if (p >= uNumPointShadows) break;
            if (uPointShadowLightIndex[p] != i) continue;

            vec3 toLight = vWorldPosition - uPointShadowPos[p];
            opaqueShadow = samplePointShadow(p, toLight, uPointFarPlane[p], N);

            if (uTransmissionEnabled) {
                transmittedLight = samplePointTransmission(p, toLight, uPointFarPlane[p]);
            }
            break;
        }

        // CALCULATE FINAL LIGHT CONTRIBUTION
        // SEPARATE SHADOW MODEL:
        // opaqueShadow (from depth map) handles blocking by opaque geometry.
        // transmittedLight (from transmission map) handles colored light from translucent objects.
        // Both are multiplied together for the final result.

        vec3 lightContrib;

        if (uTransmissionEnabled) {
            // Combine opaque shadow (depth map) with transmission (colored light filter)
            // opaqueShadow=0 means blocked by opaque geometry, regardless of transmission
            // transmittedLight=colored means light filtered through translucent objects
            vec3 effectiveLightColor = transmittedLight * uLightColors[i] * opaqueShadow;
            lightContrib = blinnPhong(N, L, V, effectiveLightColor, uLightIntensities[i]);
        } else {
            // Fallback: use opaque shadow only
            if (opaqueShadow < 0.01) {
                lightContrib = vec3(0.0);
            } else {
                lightContrib = blinnPhong(N, L, V, uLightColors[i], uLightIntensities[i]);
                lightContrib *= opaqueShadow;
            }
        }

        totalLight += lightContrib * atten;
    }

    // Reinhardt tone mapping
    totalLight = totalLight / (totalLight + vec3(1.0));
    totalLight = linearToSRGB(totalLight);

    fragColor = vec4(totalLight, uOpacity);
}
`;

// Light visualization shaders
export const LIGHT_VIS_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelMatrix;
uniform float uScale;
void main() {
    gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition * uScale, 1.0);
}
`;

export const LIGHT_VIS_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 uLightColor;
out vec4 fragColor;
void main() {
    fragColor = vec4(uLightColor, 1.0);
}
`;

// Gizmo shaders
// uNdcOffset lets the tool controller draw the gizmo multiple times with small
// screen-space offsets, faking thicker lines (WebGL2 clamps gl.lineWidth to 1).
export const GIZMO_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aColor;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelMatrix;
uniform vec2 uNdcOffset;
out vec3 vColor;
void main() {
    vColor = aColor;
    vec4 pos = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
    pos.xy += uNdcOffset * pos.w;
    gl_Position = pos;
}
`;

export const GIZMO_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
    fragColor = vec4(vColor, 1.0);
}
`;
