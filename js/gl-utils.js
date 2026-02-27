/*
    WebGL utilities - shader compilation, texture creation, framebuffer management
*/

// Compile a shader from source
export function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation error: ${info}\n\nSource:\n${source}`);
    }

    return shader;
}

// Create and link a shader program
export function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program linking error: ${info}`);
    }

    // Clean up shaders (they're linked now)
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
}

// Get all uniform locations for a program
export function getUniformLocations(gl, program, uniformNames) {
    const locations = {};
    for (const name of uniformNames) {
        locations[name] = gl.getUniformLocation(program, name);
    }
    return locations;
}

// Get all attribute locations for a program
export function getAttributeLocations(gl, program, attributeNames) {
    const locations = {};
    for (const name of attributeNames) {
        locations[name] = gl.getAttribLocation(program, name);
    }
    return locations;
}

// Create a texture from parameters
export function createTexture(gl, options = {}) {
    const {
        width = 1,
        height = 1,
        internalFormat = gl.RGBA8,
        format = gl.RGBA,
        type = gl.UNSIGNED_BYTE,
        data = null,
        minFilter = gl.LINEAR,
        magFilter = gl.LINEAR,
        wrapS = gl.CLAMP_TO_EDGE,
        wrapT = gl.CLAMP_TO_EDGE,
        generateMipmaps = false
    } = options;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);

    if (generateMipmaps) {
        gl.generateMipmap(gl.TEXTURE_2D);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
}

// Create a depth texture for shadow mapping
export function createDepthTexture(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0,
        gl.DEPTH_COMPONENT24,
        width, height, 0,
        gl.DEPTH_COMPONENT,
        gl.UNSIGNED_INT,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Enable hardware shadow comparison for sampler2DShadow (returns 0.0/1.0 instead of depth)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
}

// Create a depth texture without comparison (for reading depth values)
export function createDepthTextureNoCompare(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0,
        gl.DEPTH_COMPONENT24,
        width, height, 0,
        gl.DEPTH_COMPONENT,
        gl.UNSIGNED_INT,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
}

// Create a framebuffer with depth attachment
export function createDepthFramebuffer(gl, width, height) {
    const framebuffer = gl.createFramebuffer();
    const depthTexture = createDepthTexture(gl, width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        depthTexture,
        0
    );

    // No color attachment needed for depth-only pass
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { framebuffer, depthTexture, width, height };
}

// Create a framebuffer with color and depth attachments
export function createColorDepthFramebuffer(gl, width, height, colorFormat = gl.RGBA8) {
    const framebuffer = gl.createFramebuffer();

    const colorTexture = createTexture(gl, {
        width,
        height,
        internalFormat: colorFormat,
        format: gl.RGBA,
        type: colorFormat === gl.RGBA16F ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        minFilter: gl.LINEAR,
        magFilter: gl.LINEAR
    });

    const depthRenderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRenderbuffer);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { framebuffer, colorTexture, depthRenderbuffer, width, height };
}

// Create a transmission shadow map framebuffer (color + depth)
export function createTransmissionFramebuffer(gl, width, height) {
    const framebuffer = gl.createFramebuffer();

    // RGBA for transmittance color (RGB) and attenuation (A)
    const transmissionTexture = createTexture(gl, {
        width,
        height,
        internalFormat: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        minFilter: gl.LINEAR,
        magFilter: gl.LINEAR
    });

    const depthTexture = createDepthTextureNoCompare(gl, width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, transmissionTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Transmission framebuffer incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { framebuffer, transmissionTexture, depthTexture, width, height };
}

// Create a vertex buffer
export function createBuffer(gl, data, usage = gl.STATIC_DRAW) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buffer;
}

// Create an index buffer
export function createIndexBuffer(gl, data, usage = gl.STATIC_DRAW) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return buffer;
}

// Create a VAO (Vertex Array Object)
export function createVAO(gl, attributes, indexBuffer = null) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    for (const attr of attributes) {
        gl.bindBuffer(gl.ARRAY_BUFFER, attr.buffer);
        gl.enableVertexAttribArray(attr.location);
        gl.vertexAttribPointer(
            attr.location,
            attr.size,
            attr.type || gl.FLOAT,
            attr.normalized || false,
            attr.stride || 0,
            attr.offset || 0
        );
    }

    if (indexBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    return vao;
}

// Resize a texture
export function resizeTexture(gl, texture, width, height, internalFormat, format, type) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

// Check for WebGL errors
export function checkGLError(gl, context = '') {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
        const errorNames = {
            [gl.INVALID_ENUM]: 'INVALID_ENUM',
            [gl.INVALID_VALUE]: 'INVALID_VALUE',
            [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
            [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
            [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY'
        };
        console.error(`WebGL Error${context ? ` (${context})` : ''}: ${errorNames[error] || error}`);
        return false;
    }
    return true;
}

// Get WebGL capabilities and limits
export function getGLCapabilities(gl) {
    return {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxCubeMapSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        maxVertexUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        maxFragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        maxVaryings: gl.getParameter(gl.MAX_VARYING_VECTORS),
        maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
        maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
        floatTextureLinear: gl.getExtension('OES_texture_float_linear'),
        halfFloatTextureLinear: gl.getExtension('OES_texture_half_float_linear'),
        colorBufferFloat: gl.getExtension('EXT_color_buffer_float')
    };
}
