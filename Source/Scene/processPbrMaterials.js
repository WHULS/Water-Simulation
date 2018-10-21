define([
        './ModelUtility',
        '../Core/defined',
        '../Core/defaultValue',
        '../Core/WebGLConstants',
        '../Core/webGLConstantToGlslType',
        '../ThirdParty/GltfPipeline/addToArray',
        '../ThirdParty/GltfPipeline/ForEach',
        '../ThirdParty/GltfPipeline/hasExtension',
        '../ThirdParty/GltfPipeline/numberOfComponentsForType'
    ], function(
        ModelUtility,
        defined,
        defaultValue,
        WebGLConstants,
        webGLConstantToGlslType,
        addToArray,
        ForEach,
        hasExtension,
        numberOfComponentsForType) {
    'use strict';

    /**
     * @private
     */
    function processPbrMaterials(gltf, options) {
        options = defaultValue(options, {});

        // No need to create new techniques if they already exist,
        // the shader should handle these values
        if (hasExtension(gltf, 'KHR_techniques_webgl')) {
            return gltf;
        }

        // All materials in glTF are PBR by default,
        // so we should apply PBR unless no materials are found.
        if (!defined(gltf.materials) || gltf.materials.length === 0) {
            return gltf;
        }

        if (!defined(gltf.extensions)) {
            gltf.extensions = {};
        }

        if (!defined(gltf.extensionsUsed)) {
            gltf.extensionsUsed = [];
        }

        if (!defined(gltf.extensionsRequired)) {
            gltf.extensionsRequired = [];
        }

        gltf.extensions.KHR_techniques_webgl = {
            programs: [],
            shaders: [],
            techniques: []
        };

        gltf.extensionsUsed.push('KHR_techniques_webgl');
        gltf.extensionsRequired.push('KHR_techniques_webgl');

        var primitiveByMaterial = ModelUtility.splitIncompatibleMaterials(gltf);

        ForEach.material(gltf, function(material, materialIndex) {
            var generatedMaterialValues = {};
            var technique = generateTechnique(gltf, material, materialIndex, generatedMaterialValues, primitiveByMaterial, options);

            if (!defined(material.extensions)) {
                material.extensions = {};
            }

            material.extensions.KHR_techniques_webgl = {
                values : generatedMaterialValues,
                technique : technique
            };
        });

        // If any primitives have semantics that aren't declared in the generated
        // shaders, we want to preserve them.
        ModelUtility.ensureSemanticExistence(gltf);

        return gltf;
    }

    function isSpecularGlossinessMaterial(material) {
        return defined(material.extensions) &&
               defined(material.extensions.KHR_materials_pbrSpecularGlossiness);
    }

    function generateTechnique(gltf, material, materialIndex, generatedMaterialValues, primitiveByMaterial, options) {
        var addBatchIdToGeneratedShaders = defaultValue(options.addBatchIdToGeneratedShaders, false);

        var techniquesWebgl = gltf.extensions.KHR_techniques_webgl;
        var techniques = techniquesWebgl.techniques;
        var shaders = techniquesWebgl.shaders;
        var programs = techniquesWebgl.programs;

        var useSpecGloss = isSpecularGlossinessMaterial(material);

        var uniformName;
        var parameterName;
        var pbrMetallicRoughness = material.pbrMetallicRoughness;
        if (defined(pbrMetallicRoughness) && !useSpecGloss) {
            for (parameterName in pbrMetallicRoughness) {
                if (pbrMetallicRoughness.hasOwnProperty(parameterName)) {
                    uniformName = 'u_' + parameterName;
                    generatedMaterialValues[uniformName] = pbrMetallicRoughness[parameterName];
                }
            }
        }

        if (useSpecGloss) {
            var pbrSpecularGlossiness = material.extensions.KHR_materials_pbrSpecularGlossiness;
            for (parameterName in pbrSpecularGlossiness) {
                if (pbrSpecularGlossiness.hasOwnProperty(parameterName)) {
                    uniformName = 'u_' + parameterName;
                    generatedMaterialValues[uniformName] = pbrSpecularGlossiness[parameterName];
                }
            }
        }

        for (var additional in material) {
            if (material.hasOwnProperty(additional) && ((additional.indexOf('Texture') >= 0) || additional.indexOf('Factor') >= 0)) {
                uniformName = 'u_' + additional;
                generatedMaterialValues[uniformName] = material[additional];
            }
        }

        var vertexShader = 'precision highp float;\n';
        var fragmentShader = 'precision highp float;\n';

        var skin;
        if (defined(gltf.skins)) {
            skin = gltf.skins[0];
        }
        var joints = (defined(skin)) ? skin.joints : [];
        var jointCount = joints.length;

        var primitiveInfo = primitiveByMaterial[materialIndex];

        var skinningInfo;
        var hasSkinning = false;
        var hasVertexColors = false;
        var hasMorphTargets = false;
        var hasNormals = false;
        var hasTangents = false;
        var hasTexCoords = false;
        var isUnlit = false;

        if (defined(primitiveInfo)) {
            skinningInfo = primitiveInfo.skinning;
            hasSkinning = skinningInfo.skinned && (joints.length > 0);
            hasVertexColors = primitiveInfo.hasVertexColors;
            hasMorphTargets = primitiveInfo.hasMorphTargets;
            hasNormals = primitiveInfo.hasNormals;
            hasTangents = primitiveInfo.hasTangents;
            hasTexCoords = primitiveInfo.hasTexCoords;
        }

        var morphTargets;
        if (hasMorphTargets) {
            ForEach.mesh(gltf, function(mesh) {
                ForEach.meshPrimitive(mesh, function(primitive) {
                    if (primitive.material === materialIndex) {
                        var targets = primitive.targets;
                        if (defined(targets)) {
                            morphTargets = targets;
                        }
                    }
                });
            });
        }

        // Add techniques
        var techniqueUniforms = {
            // Add matrices
            u_modelViewMatrix : {
                semantic : hasExtension(gltf, 'CESIUM_RTC') ? 'CESIUM_RTC_MODELVIEW' : 'MODELVIEW',
                type : WebGLConstants.FLOAT_MAT4
            },
            u_projectionMatrix : {
                semantic : 'PROJECTION',
                type : WebGLConstants.FLOAT_MAT4
            }
        };

        if (defined(material.extensions) && defined(material.extensions.KHR_materials_unlit)) {
            isUnlit = true;
            hasNormals = false;
            hasTangents = false;
        }

        if (hasNormals) {
            techniqueUniforms.u_normalMatrix = {
                semantic : 'MODELVIEWINVERSETRANSPOSE',
                type : WebGLConstants.FLOAT_MAT3
            };
        }

        if (hasSkinning) {
            techniqueUniforms.u_jointMatrix = {
                count : jointCount,
                semantic : 'JOINTMATRIX',
                type : WebGLConstants.FLOAT_MAT4
            };
        }

        if (hasMorphTargets) {
            techniqueUniforms.u_morphWeights = {
                count : morphTargets.length,
                semantic : 'MORPHWEIGHTS',
                type : WebGLConstants.FLOAT
            };
        }

        var alphaMode = material.alphaMode;
        if (defined(alphaMode) && alphaMode === 'MASK') {
            techniqueUniforms.u_alphaCutoff = {
                semantic: 'ALPHACUTOFF',
                type: WebGLConstants.FLOAT
            };
        }

        // Add material values
        for (uniformName in generatedMaterialValues) {
            if (generatedMaterialValues.hasOwnProperty(uniformName)) {
                techniqueUniforms[uniformName] = {
                    type : getPBRValueType(uniformName)
                };
            }
        }

        var baseColorUniform = defaultValue(techniqueUniforms.u_baseColorTexture, techniqueUniforms.u_baseColorFactor);
        if (defined(baseColorUniform)) {
            baseColorUniform.semantic = '_3DTILESDIFFUSE';
        }

        // Add uniforms to shaders
        for (uniformName in techniqueUniforms) {
            if (techniqueUniforms.hasOwnProperty(uniformName)) {
                var uniform = techniqueUniforms[uniformName];
                var arraySize = defined(uniform.count) ? '[' + uniform.count + ']' : '';
                if (((uniform.type !== WebGLConstants.FLOAT_MAT3) && (uniform.type !== WebGLConstants.FLOAT_MAT4) && (uniformName !== 'u_morphWeights')) ||
                    uniform.useInFragment) {
                    fragmentShader += 'uniform ' + webGLConstantToGlslType(uniform.type) + ' ' + uniformName + arraySize + ';\n';
                    delete uniform.useInFragment;
                } else {
                    vertexShader += 'uniform ' + webGLConstantToGlslType(uniform.type) + ' ' + uniformName + arraySize + ';\n';
                }
            }
        }

        // Add attributes with semantics
        var vertexShaderMain = '';
        if (hasSkinning) {
            var i, j;
            var numberOfComponents = numberOfComponentsForType(skinningInfo.type);
            var matrix = false;
            if (skinningInfo.type.indexOf('MAT') === 0) {
                matrix = true;
                numberOfComponents = Math.sqrt(numberOfComponents);
            }
            if (!matrix) {
                for (i = 0; i < numberOfComponents; i++) {
                    if (i === 0) {
                        vertexShaderMain += '    mat4 skinMatrix = ';
                    } else {
                        vertexShaderMain += '    skinMatrix += ';
                    }
                    vertexShaderMain += 'a_weight[' + i + '] * u_jointMatrix[int(a_joint[' + i + '])];\n';
                }
            } else {
                for (i = 0; i < numberOfComponents; i++) {
                    for (j = 0; j < numberOfComponents; j++) {
                        if (i === 0 && j === 0) {
                            vertexShaderMain += '    mat4 skinMatrix = ';
                        } else {
                            vertexShaderMain += '    skinMatrix += ';
                        }
                        vertexShaderMain += 'a_weight[' + i + '][' + j + '] * u_jointMatrix[int(a_joint[' + i + '][' + j + '])];\n';
                    }
                }
            }
        }

        // Add position always
        var techniqueAttributes = {
            a_position : {
                semantic : 'POSITION'
            }
        };
        vertexShader += 'attribute vec3 a_position;\n';
        if (hasNormals) {
            vertexShader += 'varying vec3 v_positionEC;\n';
            vertexShader += 'varying vec3 v_positionWC;\n';
        }

        // Morph Target Weighting
        vertexShaderMain += '    vec3 weightedPosition = a_position;\n';
        if (hasNormals) {
            vertexShaderMain += '    vec3 weightedNormal = a_normal;\n';
        }
        if (hasTangents) {
            vertexShaderMain += '    vec4 weightedTangent = a_tangent;\n';
        }
        if (hasMorphTargets) {
            for (var k = 0; k < morphTargets.length; k++) {
                var targetAttributes = morphTargets[k];
                for (var targetAttribute in targetAttributes) {
                    if (targetAttributes.hasOwnProperty(targetAttribute) && targetAttribute !== 'extras') {
                        var attributeName = 'a_' + targetAttribute + '_' + k;
                        techniqueAttributes[attributeName] = {
                            semantic : targetAttribute + '_' + k
                        };
                        vertexShader += 'attribute vec3 ' + attributeName + ';\n';
                        if (targetAttribute === 'POSITION') {
                            vertexShaderMain += '    weightedPosition += u_morphWeights[' + k + '] * ' + attributeName + ';\n';
                        } else if (targetAttribute === 'NORMAL') {
                            vertexShaderMain += '    weightedNormal += u_morphWeights[' + k + '] * ' + attributeName + ';\n';
                        } else if (hasTangents && targetAttribute === 'TANGENT') {
                            vertexShaderMain += '    weightedTangent.xyz += u_morphWeights[' + k + '] * ' + attributeName + ';\n';
                        }
                    }
                }
            }
        }

        // Final position computation
        if (hasSkinning) {
            vertexShaderMain += '    vec4 position = skinMatrix * vec4(weightedPosition, 1.0);\n';
        } else {
            vertexShaderMain += '    vec4 position = vec4(weightedPosition, 1.0);\n';
        }
        if (hasNormals) {
            vertexShaderMain += '    v_positionWC = (czm_model * position).xyz;\n';
        }
        vertexShaderMain += '    position = u_modelViewMatrix * position;\n';
        if (hasNormals) {
            vertexShaderMain += '    v_positionEC = position.xyz;\n';
        }
        vertexShaderMain += '    gl_Position = u_projectionMatrix * position;\n';

        // Final normal computation
        if (hasNormals) {
            techniqueAttributes.a_normal = {
                semantic : 'NORMAL'
            };
            vertexShader += 'attribute vec3 a_normal;\n';
            vertexShader += 'varying vec3 v_normal;\n';
            if (hasSkinning) {
                vertexShaderMain += '    v_normal = u_normalMatrix * mat3(skinMatrix) * weightedNormal;\n';
            } else {
                vertexShaderMain += '    v_normal = u_normalMatrix * weightedNormal;\n';
            }

            fragmentShader += 'varying vec3 v_normal;\n';
            fragmentShader += 'varying vec3 v_positionEC;\n';
            fragmentShader += 'varying vec3 v_positionWC;\n';
        }

        // Read tangents if available
        if (hasTangents) {
            techniqueAttributes.a_tangent = {
                semantic : 'TANGENT'
            };
            vertexShader += 'attribute vec4 a_tangent;\n';
            vertexShader += 'varying vec4 v_tangent;\n';
            vertexShaderMain += '    v_tangent.xyz = u_normalMatrix * weightedTangent.xyz;\n';
            vertexShaderMain += '    v_tangent.w = weightedTangent.w;\n';

            fragmentShader += 'varying vec4 v_tangent;\n';
        }

        // Add texture coordinates if the material uses them
        var v_texcoord;
        if (hasTexCoords) {
            techniqueAttributes.a_texcoord_0 = {
                semantic : 'TEXCOORD_0'
            };

            v_texcoord = 'v_texcoord_0';
            vertexShader += 'attribute vec2 a_texcoord_0;\n';
            vertexShader += 'varying vec2 ' + v_texcoord + ';\n';
            vertexShaderMain += '    ' + v_texcoord + ' = a_texcoord_0;\n';

            fragmentShader += 'varying vec2 ' + v_texcoord + ';\n';
        }

        // Add skinning information if available
        if (hasSkinning) {
            var attributeType = ModelUtility.getShaderVariable(skinningInfo.type);
            techniqueAttributes.a_joint = {
                semantic : 'JOINTS_0'
            };
            techniqueAttributes.a_weight ={
                semantic : 'WEIGHTS_0'
            };

            vertexShader += 'attribute ' + attributeType + ' a_joint;\n';
            vertexShader += 'attribute ' + attributeType + ' a_weight;\n';
        }

        if (hasVertexColors) {
            techniqueAttributes.a_vertexColor = {
                semantic: 'COLOR_0'
            };
            vertexShader += 'attribute vec4 a_vertexColor;\n';
            vertexShader += 'varying vec4 v_vertexColor;\n';
            vertexShaderMain += '  v_vertexColor = a_vertexColor;\n';
            fragmentShader += 'varying vec4 v_vertexColor;\n';
        }

        if (addBatchIdToGeneratedShaders) {
            techniqueAttributes.a_batchId = {
                semantic: '_BATCHID'
            };
            vertexShader += 'attribute float a_batchId;\n';
        }

        vertexShader += 'void main(void) \n{\n';
        vertexShader += vertexShaderMain;
        vertexShader += '}\n';

        // Fragment shader lighting
        if (hasNormals) {
            fragmentShader += 'const float M_PI = 3.141592653589793;\n';

            fragmentShader += 'vec3 lambertianDiffuse(vec3 diffuseColor) \n' +
                '{\n' +
                '    return diffuseColor / M_PI;\n' +
                '}\n\n';

            fragmentShader += 'vec3 fresnelSchlick2(vec3 f0, vec3 f90, float VdotH) \n' +
                '{\n' +
                '    return f0 + (f90 - f0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);\n' +
                '}\n\n';

            fragmentShader += 'vec3 fresnelSchlick(float metalness, float VdotH) \n' +
                '{\n' +
                '    return metalness + (vec3(1.0) - metalness) * pow(1.0 - VdotH, 5.0);\n' +
                '}\n\n';

            fragmentShader += 'float smithVisibilityG1(float NdotV, float roughness) \n' +
                '{\n' +
                '    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;\n' +
                '    return NdotV / (NdotV * (1.0 - k) + k);\n' +
                '}\n\n';

            fragmentShader += 'float smithVisibilityGGX(float roughness, float NdotL, float NdotV) \n' +
                '{\n' +
                '    return smithVisibilityG1(NdotL, roughness) * smithVisibilityG1(NdotV, roughness);\n' +
                '}\n\n';

            fragmentShader += 'float GGX(float roughness, float NdotH) \n' +
                '{\n' +
                '    float roughnessSquared = roughness * roughness;\n' +
                '    float f = (NdotH * roughnessSquared - NdotH) * NdotH + 1.0;\n' +
                '    return roughnessSquared / (M_PI * f * f);\n' +
                '}\n\n';
        }

        fragmentShader += 'vec3 SRGBtoLINEAR3(vec3 srgbIn) \n' +
            '{\n' +
            '    return pow(srgbIn, vec3(2.2));\n' +
            '}\n\n';

        fragmentShader += 'vec4 SRGBtoLINEAR4(vec4 srgbIn) \n' +
            '{\n' +
            '    vec3 linearOut = pow(srgbIn.rgb, vec3(2.2));\n' +
            '    return vec4(linearOut, srgbIn.a);\n' +
            '}\n\n';

        fragmentShader += 'vec3 LINEARtoSRGB(vec3 linearIn) \n' +
            '{\n' +
            '    return pow(linearIn, vec3(1.0/2.2));\n' +
            '}\n\n';

        fragmentShader += 'void main(void) \n{\n';

        // Add normal mapping to fragment shader
        if (hasNormals) {
            fragmentShader += '    vec3 ng = normalize(v_normal);\n';
            if (defined(generatedMaterialValues.u_normalTexture)) {
                if (hasTangents) {
                    // Read tangents from varying
                    fragmentShader += '    vec3 t = normalize(v_tangent.xyz);\n';
                    fragmentShader += '    vec3 b = normalize(cross(ng, t) * v_tangent.w);\n';
                    fragmentShader += '    mat3 tbn = mat3(t, b, ng);\n';
                    fragmentShader += '    vec3 n = texture2D(u_normalTexture, ' + v_texcoord + ').rgb;\n';
                    fragmentShader += '    n = normalize(tbn * (2.0 * n - 1.0));\n';
                } else {
                    // Add standard derivatives extension
                    fragmentShader = '#ifdef GL_OES_standard_derivatives\n' +
                        '#extension GL_OES_standard_derivatives : enable\n' +
                        '#endif\n' +
                        fragmentShader;
                    // Compute tangents
                    fragmentShader += '#ifdef GL_OES_standard_derivatives\n';
                    fragmentShader += '    vec3 pos_dx = dFdx(v_positionEC);\n';
                    fragmentShader += '    vec3 pos_dy = dFdy(v_positionEC);\n';
                    fragmentShader += '    vec3 tex_dx = dFdx(vec3(' + v_texcoord + ',0.0));\n';
                    fragmentShader += '    vec3 tex_dy = dFdy(vec3(' + v_texcoord + ',0.0));\n';
                    fragmentShader += '    vec3 t = (tex_dy.t * pos_dx - tex_dx.t * pos_dy) / (tex_dx.s * tex_dy.t - tex_dy.s * tex_dx.t);\n';
                    fragmentShader += '    t = normalize(t - ng * dot(ng, t));\n';
                    fragmentShader += '    vec3 b = normalize(cross(ng, t));\n';
                    fragmentShader += '    mat3 tbn = mat3(t, b, ng);\n';
                    fragmentShader += '    vec3 n = texture2D(u_normalTexture, ' + v_texcoord + ').rgb;\n';
                    fragmentShader += '    n = normalize(tbn * (2.0 * n - 1.0));\n';
                    fragmentShader += '#else\n';
                    fragmentShader += '    vec3 n = ng;\n';
                    fragmentShader += '#endif\n';
                }
            } else {
                fragmentShader += '    vec3 n = ng;\n';
            }
            if (material.doubleSided) {
                fragmentShader += '    if (!gl_FrontFacing)\n';
                fragmentShader += '    {\n';
                fragmentShader += '        n = -n;\n';
                fragmentShader += '    }\n';
            }
        }

        // Add base color to fragment shader
        if (defined(generatedMaterialValues.u_baseColorTexture)) {
            fragmentShader += '    vec4 baseColorWithAlpha = SRGBtoLINEAR4(texture2D(u_baseColorTexture, ' + v_texcoord + '));\n';
            if (defined(generatedMaterialValues.u_baseColorFactor)) {
                fragmentShader += '    baseColorWithAlpha *= u_baseColorFactor;\n';
            }
        } else if (defined(generatedMaterialValues.u_baseColorFactor)) {
                fragmentShader += '    vec4 baseColorWithAlpha = u_baseColorFactor;\n';
            } else {
                fragmentShader += '    vec4 baseColorWithAlpha = vec4(1.0);\n';
            }

        if (hasVertexColors) {
            fragmentShader += '    baseColorWithAlpha *= v_vertexColor;\n';
        }

        fragmentShader += '    vec3 baseColor = baseColorWithAlpha.rgb;\n';

        if (hasNormals) {
            if (useSpecGloss) {
                if (defined(generatedMaterialValues.u_specularGlossinessTexture)) {
                    fragmentShader += '    vec4 specularGlossiness = SRGBtoLINEAR4(texture2D(u_specularGlossinessTexture, ' + v_texcoord + '));\n';
                    fragmentShader += '    vec3 specular = specularGlossiness.rgb;\n';
                    fragmentShader += '    float glossiness = specularGlossiness.a;\n';
                    if (defined(generatedMaterialValues.u_specularFactor)) {
                        fragmentShader += '    specular *= u_specularFactor;\n';
                    }
                    if (defined(generatedMaterialValues.u_glossinessFactor)) {
                        fragmentShader += '    glossiness *= u_glossinessFactor;\n';
                    }
                } else {
                    if (defined(generatedMaterialValues.u_specularFactor)) {
                        fragmentShader += '    vec3 specular = clamp(u_specularFactor, vec3(0.0), vec3(1.0));\n';
                    } else {
                        fragmentShader += '    vec3 specular = vec3(1.0);\n';
                    }
                    if (defined(generatedMaterialValues.u_glossinessFactor)) {
                        fragmentShader += '    float glossiness = clamp(u_glossinessFactor, 0.0, 1.0);\n';
                    } else {
                        fragmentShader += '    float glossiness = 1.0;\n';
                    }
                }
                if (defined(generatedMaterialValues.u_diffuseTexture)) {
                    fragmentShader += '    vec4 diffuse = SRGBtoLINEAR4(texture2D(u_diffuseTexture, ' + v_texcoord + '));\n';
                    if (defined(generatedMaterialValues.u_diffuseFactor)) {
                        fragmentShader += '    diffuse *= u_diffuseFactor;\n';
                    }
                } else if (defined(generatedMaterialValues.u_diffuseFactor)) {
                    fragmentShader += '    vec4 diffuse = clamp(u_diffuseFactor, vec4(0.0), vec4(1.0));\n';
                } else {
                    fragmentShader += '    vec4 diffuse = vec4(1.0);\n';
                }
            } else if (defined(generatedMaterialValues.u_metallicRoughnessTexture)) {
                fragmentShader += '    vec3 metallicRoughness = texture2D(u_metallicRoughnessTexture, ' + v_texcoord + ').rgb;\n';
                fragmentShader += '    float metalness = clamp(metallicRoughness.b, 0.0, 1.0);\n';
                fragmentShader += '    float roughness = clamp(metallicRoughness.g, 0.04, 1.0);\n';
                if (defined(generatedMaterialValues.u_metallicFactor)) {
                    fragmentShader += '    metalness *= u_metallicFactor;\n';
                }
                if (defined(generatedMaterialValues.u_roughnessFactor)) {
                    fragmentShader += '    roughness *= u_roughnessFactor;\n';
                }
            } else {
                if (defined(generatedMaterialValues.u_metallicFactor)) {
                    fragmentShader += '    float metalness = clamp(u_metallicFactor, 0.0, 1.0);\n';
                } else {
                    fragmentShader += '    float metalness = 1.0;\n';
                }
                if (defined(generatedMaterialValues.u_roughnessFactor)) {
                    fragmentShader += '    float roughness = clamp(u_roughnessFactor, 0.04, 1.0);\n';
                } else {
                    fragmentShader += '    float roughness = 1.0;\n';
                }
            }

            fragmentShader += '    vec3 v = -normalize(v_positionEC);\n';

            // Generate fragment shader's lighting block
            // The Sun is brighter than your average light source, and has a yellowish tint balanced by the Earth's ambient blue.
            fragmentShader += '    vec3 lightColor = vec3(1.5, 1.4, 1.2);\n';
            fragmentShader += '    vec3 l = normalize(czm_sunDirectionEC);\n';
            fragmentShader += '    vec3 h = normalize(v + l);\n';
            fragmentShader += '    vec3 r = normalize(czm_inverseViewRotation * normalize(reflect(v, n)));\n';
            // Figure out if the reflection vector hits the ellipsoid
            fragmentShader += '    czm_ellipsoid ellipsoid = czm_getWgs84EllipsoidEC();\n';
            fragmentShader += '    float vertexRadius = length(v_positionWC);\n';
            fragmentShader += '    float horizonDotNadir = 1.0 - min(1.0, ellipsoid.radii.x / vertexRadius);\n';
            fragmentShader += '    float reflectionDotNadir = dot(r, normalize(v_positionWC));\n';
            // Flipping the X vector is a cheap way to get the inverse of czm_temeToPseudoFixed, since that's a rotation about Z.
            fragmentShader += '    r.x = -r.x;\n';
            fragmentShader += '    r = -normalize(czm_temeToPseudoFixed * r);\n';
            fragmentShader += '    r.x = -r.x;\n';
            fragmentShader += '    float NdotL = clamp(dot(n, l), 0.001, 1.0);\n';
            fragmentShader += '    float NdotV = abs(dot(n, v)) + 0.001;\n';
            fragmentShader += '    float NdotH = clamp(dot(n, h), 0.0, 1.0);\n';
            fragmentShader += '    float LdotH = clamp(dot(l, h), 0.0, 1.0);\n';
            fragmentShader += '    float VdotH = clamp(dot(v, h), 0.0, 1.0);\n';
            fragmentShader += '    vec3 f0 = vec3(0.04);\n';
            // Whether the material uses metallic-roughness or specular-glossiness changes how the BRDF inputs are computed.
            // It does not change the implementation of the BRDF itself.
            if (useSpecGloss) {
                fragmentShader += '    float roughness = 1.0 - glossiness;\n';
                fragmentShader += '    vec3 diffuseColor = diffuse.rgb * (1.0 - max(max(specular.r, specular.g), specular.b));\n';
                fragmentShader += '    vec3 specularColor = specular;\n';
            } else {
                fragmentShader += '    vec3 diffuseColor = baseColor * (1.0 - metalness) * (1.0 - f0);\n';
                fragmentShader += '    vec3 specularColor = mix(f0, baseColor, metalness);\n';
            }

            fragmentShader += '    float alpha = roughness * roughness;\n';
            fragmentShader += '    float reflectance = max(max(specularColor.r, specularColor.g), specularColor.b);\n';
            fragmentShader += '    vec3 r90 = vec3(clamp(reflectance * 25.0, 0.0, 1.0));\n';
            fragmentShader += '    vec3 r0 = specularColor.rgb;\n';

            fragmentShader += '    vec3 F = fresnelSchlick2(r0, r90, VdotH);\n';
            fragmentShader += '    float G = smithVisibilityGGX(alpha, NdotL, NdotV);\n';
            fragmentShader += '    float D = GGX(alpha, NdotH);\n';

            fragmentShader += '    vec3 diffuseContribution = (1.0 - F) * lambertianDiffuse(diffuseColor);\n';
            fragmentShader += '    vec3 specularContribution = F * G * D / (4.0 * NdotL * NdotV);\n';
            fragmentShader += '    vec3 color = NdotL * lightColor * (diffuseContribution + specularContribution);\n';

            fragmentShader += '    float inverseRoughness = 1.04 - roughness;\n';
            fragmentShader += '    inverseRoughness *= inverseRoughness;\n';
            fragmentShader += '    vec3 sceneSkyBox = textureCube(czm_environmentMap, r).rgb * inverseRoughness;\n';

            fragmentShader += '    float atmosphereHeight = 0.05;\n';
            fragmentShader += '    float blendRegionSize = 0.1 * ((1.0 - inverseRoughness) * 8.0 + 1.1 - horizonDotNadir);\n';
            fragmentShader += '    float blendRegionOffset = roughness * -1.0;\n';
            fragmentShader += '    float farAboveHorizon = clamp(horizonDotNadir - blendRegionSize * 0.5 + blendRegionOffset, 1.0e-10 - blendRegionSize, 0.99999);\n';
            fragmentShader += '    float aroundHorizon = clamp(horizonDotNadir + blendRegionSize * 0.5, 1.0e-10 - blendRegionSize, 0.99999);\n';
            fragmentShader += '    float farBelowHorizon = clamp(horizonDotNadir + blendRegionSize * 1.5, 1.0e-10 - blendRegionSize, 0.99999);\n';
            fragmentShader += '    float smoothstepHeight = smoothstep(0.0, atmosphereHeight, horizonDotNadir);\n';

            fragmentShader += '    vec3 belowHorizonColor = mix(vec3(0.1, 0.15, 0.25), vec3(0.4, 0.7, 0.9), smoothstepHeight);\n';
            fragmentShader += '    vec3 nadirColor = belowHorizonColor * 0.5;\n';
            fragmentShader += '    vec3 aboveHorizonColor = mix(vec3(0.9, 1.0, 1.2), belowHorizonColor, roughness * 0.5);\n';
            fragmentShader += '    vec3 blueSkyColor = mix(vec3(0.18, 0.26, 0.48), aboveHorizonColor, reflectionDotNadir * inverseRoughness * 0.5 + 0.75);\n';
            fragmentShader += '    vec3 zenithColor = mix(blueSkyColor, sceneSkyBox, smoothstepHeight);\n';

            fragmentShader += '    vec3 blueSkyDiffuseColor = vec3(0.7, 0.85, 0.9);\n';
            fragmentShader += '    float diffuseIrradianceFromEarth = (1.0 - horizonDotNadir) * (reflectionDotNadir * 0.25 + 0.75) * smoothstepHeight;\n';
            fragmentShader += '    float diffuseIrradianceFromSky = (1.0 - smoothstepHeight) * (1.0 - (reflectionDotNadir * 0.25 + 0.25));\n';
            fragmentShader += '    vec3 diffuseIrradiance = blueSkyDiffuseColor * clamp(diffuseIrradianceFromEarth + diffuseIrradianceFromSky, 0.0, 1.0);\n';

            fragmentShader += '    float notDistantRough = (1.0 - horizonDotNadir * roughness * 0.8);\n';
            fragmentShader += '    vec3 specularIrradiance = mix(zenithColor, aboveHorizonColor, smoothstep(farAboveHorizon, aroundHorizon, reflectionDotNadir) * notDistantRough);\n';
            fragmentShader += '    specularIrradiance = mix(specularIrradiance, belowHorizonColor, smoothstep(aroundHorizon, farBelowHorizon, reflectionDotNadir) * inverseRoughness);\n';
            fragmentShader += '    specularIrradiance = mix(specularIrradiance, nadirColor, smoothstep(farBelowHorizon, 1.0, reflectionDotNadir) * inverseRoughness);\n';

            fragmentShader += '    vec2 brdfLut = texture2D(czm_brdfLut, vec2(NdotV, 1.0 - roughness)).rg;\n';
            fragmentShader += '    vec3 IBLColor = (diffuseIrradiance * diffuseColor) + (specularIrradiance * SRGBtoLINEAR3(specularColor * brdfLut.x + brdfLut.y));\n';
            fragmentShader += '    color += IBLColor;\n';
        } else {
            fragmentShader += '    vec3 color = baseColor;\n';
        }

        // Ignore occlusion and emissive when unlit
        if (!isUnlit) {
            if (defined(generatedMaterialValues.u_occlusionTexture)) {
                fragmentShader += '    color *= texture2D(u_occlusionTexture, ' + v_texcoord + ').r;\n';
            }
            if (defined(generatedMaterialValues.u_emissiveTexture)) {
                fragmentShader += '    vec3 emissive = SRGBtoLINEAR3(texture2D(u_emissiveTexture, ' + v_texcoord + ').rgb);\n';
                if (defined(generatedMaterialValues.u_emissiveFactor)) {
                    fragmentShader += '    emissive *= u_emissiveFactor;\n';
                }
                fragmentShader += '    color += emissive;\n';
            } else if (defined(generatedMaterialValues.u_emissiveFactor)) {
                fragmentShader += '    color += u_emissiveFactor;\n';
            }
        }

        // Final color
        fragmentShader += '    color = LINEARtoSRGB(color);\n';
        if (defined(alphaMode)) {
            if (alphaMode === 'MASK') {
                fragmentShader += '    if (baseColorWithAlpha.a < u_alphaCutoff) {\n';
                fragmentShader += '        discard;\n';
                fragmentShader += '    }\n';
                fragmentShader += '    gl_FragColor = vec4(color, 1.0);\n';
            } else if (alphaMode === 'BLEND') {
                fragmentShader += '    gl_FragColor = vec4(color, baseColorWithAlpha.a);\n';
            } else {
                fragmentShader += '    gl_FragColor = vec4(color, 1.0);\n';
            }
        } else {
            fragmentShader += '    gl_FragColor = vec4(color, 1.0);\n';
        }
        fragmentShader += '}\n';

        // Add shaders
        var vertexShaderId = addToArray(shaders, {
            type : WebGLConstants.VERTEX_SHADER,
            extras : {
                _pipeline : {
                    source : vertexShader,
                    extension : '.glsl'
                }
            }
        });

        var fragmentShaderId = addToArray(shaders, {
            type : WebGLConstants.FRAGMENT_SHADER,
            extras : {
                _pipeline : {
                    source : fragmentShader,
                    extension : '.glsl'
                }
            }
        });

        // Add program
        var programId = addToArray(programs, {
            fragmentShader : fragmentShaderId,
            vertexShader : vertexShaderId
        });

        var techniqueId = addToArray(techniques, {
            attributes : techniqueAttributes,
            program : programId,
            uniforms : techniqueUniforms
        });

        return techniqueId;
    }

    function getPBRValueType(paramName) {
        switch (paramName) {
            case 'u_baseColorFactor':
                return WebGLConstants.FLOAT_VEC4;
            case 'u_metallicFactor':
                return WebGLConstants.FLOAT;
            case 'u_roughnessFactor':
                return WebGLConstants.FLOAT;
            case 'u_baseColorTexture':
                return WebGLConstants.SAMPLER_2D;
            case 'u_metallicRoughnessTexture':
                return WebGLConstants.SAMPLER_2D;
            case 'u_normalTexture':
                return WebGLConstants.SAMPLER_2D;
            case 'u_occlusionTexture':
                return WebGLConstants.SAMPLER_2D;
            case 'u_emissiveTexture':
                return WebGLConstants.SAMPLER_2D;
            case 'u_emissiveFactor':
                return WebGLConstants.FLOAT_VEC3;
            // Specular Glossiness Types
            case 'u_diffuseFactor':
                return WebGLConstants.FLOAT_VEC4;
            case 'u_specularFactor':
                return WebGLConstants.FLOAT_VEC3;
            case 'u_glossinessFactor':
                return WebGLConstants.FLOAT;
            case 'u_diffuseTexture':
                return WebGLConstants.SAMPLER_2D;
            case 'u_specularGlossinessTexture':
                return WebGLConstants.SAMPLER_2D;
        }
    }

    return processPbrMaterials;
});
