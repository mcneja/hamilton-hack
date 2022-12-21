/*
    Hamiltonian Path Hacking Minigame
*/

import { mat4, vec2 } from "./my-matrix";

window.onload = loadResourcesThenRun;

const graphSizeX = 11;
const graphSizeY = 11;

type Coord = [number, number];

type Node = {
    coord: Coord;
    next: number | undefined;
    group: number | undefined;
}

type Graph = {
    node: Array<Node>;
    extents: Coord;
    start: number;
    goal: number;
}

type GlyphDisc = {
    position: vec2;
    radius: number;
    discColor: number;
    glyphIndex: number;
    glyphColor: number;
}

type RenderRects = {
    start: (matScreenFromWorld: mat4) => void;
    addRect: (x0: number, y0: number, x1: number, y1: number, color: number) => void;
    flush: () => void;
}

type RenderGlyphs = {
    start: (matScreenFromWorld: mat4) => void;
    addGlyph: (x0: number, y0: number, x1: number, y1: number, glyphIndex: number, color: number) => void;
    flush: () => void;
}

type BeginFrame = () => vec2;
type RenderDiscs = (matScreenFromWorld: mat4, discs: Array<GlyphDisc>) => void;

type Renderer = {
    beginFrame: BeginFrame;
    renderRects: RenderRects;
    renderDiscs: RenderDiscs;
    renderGlyphs: RenderGlyphs;
}

type Enemy = {
    nodeIndex: number;
    progressFraction: number;
}

type State = {
    tLast: number | undefined;
    paused: boolean;
    graph: Graph;
    enemy: Enemy;
    pointerGridPos: vec2 | undefined;
}

function loadResourcesThenRun() {
    console.log("starting load");
    loadImage("font.png",
        (img: HTMLImageElement) => {
            main(img);
        },
        (err: any) => { });
    // loadImage("font.png").then(() => {
    //     console.log("loaded font.png");
    // });

    //loadImage('font.png').then((fontImage) => { main(fontImage as HTMLImageElement); });
}

function main(fontImage: HTMLImageElement) {

    const canvas = document.querySelector("#canvas") as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2", { alpha: false, depth: false }) as WebGL2RenderingContext;

    if (gl == null) {
        alert("Unable to initialize WebGL2. Your browser or machine may not support it.");
        return;
    }

    const renderer = createRenderer(gl, fontImage);
    const state = initState();

    function gridPosFromEventPos(x: number, y: number): vec2 {
        const canvasRect = canvas.getBoundingClientRect();
        const screenSize = vec2.fromValues(canvas.width, canvas.height);
        const posPointer = vec2.fromValues(x - canvasRect.left, canvasRect.bottom - y);
        return graphCoordsFromCanvasPos(state.graph.extents, screenSize, posPointer);
    }

    canvas.onpointerdown = (event) => {
        const gridPos = gridPosFromEventPos(event.clientX, event.clientY);

        const x = Math.floor(gridPos[0]);
        const y = Math.floor(gridPos[1]);
        if (x >= 0 && y >= 0 && x < state.graph.extents[0] - 1 && y < state.graph.extents[1] - 1) {
            tryRotate(state.graph, [x, y]);
        }

        if (state.paused) {
            requestUpdateAndRender();
        }
    };

    canvas.onmousemove = (event) => {
        const gridPos = gridPosFromEventPos(event.clientX, event.clientY);
        if (state.pointerGridPos !== undefined &&
            state.pointerGridPos[0] === gridPos[0] &&
            state.pointerGridPos[1] === gridPos[1]) {
            return;
        }

        state.pointerGridPos = gridPos;

        if (state.paused) {
            requestUpdateAndRender();
        }
    };

    canvas.onmouseenter = (event) => {
        const gridPos = gridPosFromEventPos(event.clientX, event.clientY);
        if (state.pointerGridPos !== undefined &&
            state.pointerGridPos[0] === gridPos[0] &&
            state.pointerGridPos[1] === gridPos[1]) {
            return;
        }

        state.pointerGridPos = gridPos;

        if (state.paused) {
            requestUpdateAndRender();
        }
    }

    canvas.onmouseleave = (event) => {
        state.pointerGridPos = undefined;

        if (state.paused) {
            requestUpdateAndRender();
        }
    };

    document.body.addEventListener('keydown', e => {
        if (e.code === 'KeyR') {
            e.preventDefault();
            resetState(state);
            if (state.paused) {
                requestUpdateAndRender();
            }
        } else if (e.code === 'KeyP') {
            e.preventDefault();
            state.paused = !state.paused;
            if (!state.paused) {
                requestUpdateAndRender();
            }
        }
    });

    function requestUpdateAndRender() {
        requestAnimationFrame(now => updateAndRender(now, renderer, state));
    }

    function onWindowResized() {
        requestUpdateAndRender();
    }

    window.addEventListener('resize', onWindowResized);

    requestUpdateAndRender();
}

const loadImage = function (src: string, continuation: (img: HTMLImageElement) => void, onError: (any) => void) {
    console.log(`Loading Image ${src}`);
    new URL(src, import.meta.url); // Tell parcel to build this in

    const img = new Image();
    img.onload = () => {
        console.log(`Finished loading Image ${src}`);
        continuation(img);
    };
    img.onerror = (err: any) => {
        console.log(`Error loading Image ${src}`);
        console.log(err);
        onError(err);
    }
    img.src = src;
};

function createRenderer(gl: WebGL2RenderingContext, fontImage: HTMLImageElement): Renderer {
    const glyphTexture = createGlyphTextureFromImage(gl, fontImage);

    const renderer = {
        beginFrame: createBeginFrame(gl),
        renderRects: createRectsRenderer(gl),
        renderDiscs: createDiscRenderer(gl, glyphTexture),
        renderGlyphs: createGlyphRenderer(gl, glyphTexture),
    };

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    gl.clearColor(0.05, 0.2, 0.05, 1);

    return renderer;
}

function initState(): State {
    const graph = createGraph(graphSizeX, graphSizeY);
    return {
        tLast: undefined,
        paused: false,
        graph: graph,
        enemy: {
            nodeIndex: graph.goal,
            progressFraction: 0,
        },
        pointerGridPos: undefined,
    };
}

function resetState(state: State) {
    state.graph = createGraph(graphSizeX, graphSizeY);
    state.enemy.nodeIndex = state.graph.goal;
    state.enemy.progressFraction = 0;
}

function createBeginFrame(gl: WebGL2RenderingContext): BeginFrame {
    return () => {
        const canvas = gl.canvas as HTMLCanvasElement;

        resizeCanvasToDisplaySize(canvas);

        const screenX = canvas.clientWidth;
        const screenY = canvas.clientHeight;

        gl.viewport(0, 0, screenX, screenY);
        gl.clear(gl.COLOR_BUFFER_BIT);

        return vec2.fromValues(screenX, screenY);
    }
}

function createDiscRenderer(gl: WebGL2RenderingContext, glyphTexture: WebGLTexture): RenderDiscs {
    const vsSource = `#version 300 es
        // per-vertex parameters
        in highp vec2 vPosition;
        // per-instance parameters
        in highp vec4 vScaleAndOffset;
        in highp vec4 vDiscColorAndOpacity;
        in highp vec3 vGlyphColor;
        in highp float vGlyphIndex;

        uniform mat4 uMatScreenFromWorld;
        uniform vec4 uScaleAndOffsetGlyphFromDisc;

        out highp vec2 fDiscPosition;
        out highp vec3 fGlyphTexCoord;
        out highp vec4 fDiscColorAndOpacity;
        out highp vec3 fGlyphColor;

        void main() {
            fDiscPosition = vPosition;
            fGlyphTexCoord = vec3(vPosition * uScaleAndOffsetGlyphFromDisc.xy + uScaleAndOffsetGlyphFromDisc.zw, vGlyphIndex);
            fDiscColorAndOpacity = vDiscColorAndOpacity;
            fGlyphColor = vGlyphColor;
            gl_Position = uMatScreenFromWorld * vec4(vPosition * vScaleAndOffset.xy + vScaleAndOffset.zw, 0, 1);
        }
    `;

    const fsSource = `#version 300 es
        in highp vec2 fDiscPosition;
        in highp vec3 fGlyphTexCoord;
        in highp vec4 fDiscColorAndOpacity;
        in highp vec3 fGlyphColor;

        uniform highp sampler2DArray uGlyphOpacity;

        out lowp vec4 fragColor;

        void main() {
            highp float glyphOpacity =
                step(0.0, fGlyphTexCoord.x) *
                step(0.0, 1.0 - fGlyphTexCoord.x) *
                step(0.0, fGlyphTexCoord.y) *
                step(0.0, 1.0 - fGlyphTexCoord.y) *
                texture(uGlyphOpacity, fGlyphTexCoord).x;
            highp float r = length(fDiscPosition);
            highp float aaf = fwidth(r);
            highp float discOpacity = fDiscColorAndOpacity.w * (1.0 - smoothstep(1.0 - aaf, 1.0, r));
            highp vec3 color = mix(fDiscColorAndOpacity.xyz, fGlyphColor, glyphOpacity);
            fragColor = vec4(color, discOpacity);
        }
    `;

    const attribs = {
        vPosition: 0,
        vScaleAndOffset: 1,
        vDiscColorAndOpacity: 2,
        vGlyphColor: 3,
        vGlyphIndex: 4,
    };

    const vecScaleAndOffsetGlyphFromDisc = [1, -0.5, 0.5, 0.45];

    const program = initShaderProgram(gl, vsSource, fsSource, attribs);

    const locMatScreenFromWorld = gl.getUniformLocation(program, 'uMatScreenFromWorld');
    const locScaleAndOffsetGlyphFromDisc = gl.getUniformLocation(program, 'uScaleAndOffsetGlyphFromDisc');
    const locGlyphOpacity = gl.getUniformLocation(program, 'uGlyphOpacity');

    const maxInstances = 64;
    const bytesPerInstance = 24; // 2 float scale, 2 float offset, 4 byte disc color/opacity, 4 byte glyph color/index
    const instanceData = new ArrayBuffer(maxInstances * bytesPerInstance);
    const instanceDataAsFloat32 = new Float32Array(instanceData);
    const instanceDataAsUint32 = new Uint32Array(instanceData);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // per-vertex attributes
    const vertexBuffer = createDiscVertexBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(attribs.vPosition);
    gl.vertexAttribPointer(attribs.vPosition, 2, gl.FLOAT, false, 0, 0);

    // per-instance attributes
    const instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(attribs.vScaleAndOffset);
    gl.enableVertexAttribArray(attribs.vDiscColorAndOpacity);
    gl.enableVertexAttribArray(attribs.vGlyphColor);
    gl.enableVertexAttribArray(attribs.vGlyphIndex);
    gl.vertexAttribPointer(attribs.vScaleAndOffset, 4, gl.FLOAT, false, bytesPerInstance, 0);
    gl.vertexAttribPointer(attribs.vDiscColorAndOpacity, 4, gl.UNSIGNED_BYTE, true, bytesPerInstance, 16);
    gl.vertexAttribPointer(attribs.vGlyphColor, 3, gl.UNSIGNED_BYTE, true, bytesPerInstance, 20);
    gl.vertexAttribPointer(attribs.vGlyphIndex, 1, gl.UNSIGNED_BYTE, false, bytesPerInstance, 23);
    gl.vertexAttribDivisor(attribs.vScaleAndOffset, 1);
    gl.vertexAttribDivisor(attribs.vDiscColorAndOpacity, 1);
    gl.vertexAttribDivisor(attribs.vGlyphColor, 1);
    gl.vertexAttribDivisor(attribs.vGlyphIndex, 1);

    gl.bindVertexArray(null);

    return (matScreenFromWorld, discs) => {
        gl.useProgram(program);

        gl.bindVertexArray(vao);

        gl.uniformMatrix4fv(locMatScreenFromWorld, false, matScreenFromWorld);
        gl.uniform4fv(locScaleAndOffsetGlyphFromDisc, vecScaleAndOffsetGlyphFromDisc);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, glyphTexture);
        gl.uniform1i(locGlyphOpacity, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);

        let discIndexStart = 0;
        while (discIndexStart < discs.length) {
            const numInstances = Math.min(maxInstances, discs.length - discIndexStart);

            // Load disc data into the instance buffer

            for (let i = 0; i < numInstances; ++i) {
                const disc = discs[discIndexStart + i];

                let j = i * bytesPerInstance / 4;
                instanceDataAsFloat32[j + 0] = disc.radius;
                instanceDataAsFloat32[j + 1] = disc.radius;
                instanceDataAsFloat32[j + 2] = disc.position[0];
                instanceDataAsFloat32[j + 3] = disc.position[1];
                instanceDataAsUint32[j + 4] = disc.discColor;
                instanceDataAsUint32[j + 5] = (disc.glyphColor & 0xffffff) + (disc.glyphIndex << 24);
            }

            gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData); // would like to only submit data for instances we will draw, not the whole buffer

            gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, numInstances);

            discIndexStart += numInstances;
        }

        gl.bindVertexArray(null);
    };
}

function createDiscVertexBuffer(gl: WebGL2RenderingContext) {
    const v = new Float32Array(6 * 2);
    let i = 0;

    function makeVert(x: number, y: number) {
        v[i++] = x;
        v[i++] = y;
    }

    makeVert(-1, -1);
    makeVert(1, -1);
    makeVert(1, 1);
    makeVert(1, 1);
    makeVert(-1, 1);
    makeVert(-1, -1);

    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);

    return vertexBuffer;
}

function createRectsRenderer(gl: WebGL2RenderingContext): RenderRects {
    const vsSource = `#version 300 es
        in vec2 vPosition;
        in vec4 vColor;

        uniform mat4 uMatScreenFromWorld;

        out highp vec4 fColor;

        void main() {
            fColor = vColor;
            gl_Position = uMatScreenFromWorld * vec4(vPosition, 0, 1);
        }
    `;

    const fsSource = `#version 300 es
        in highp vec4 fColor;

        out lowp vec4 fragColor;

        void main() {
            fragColor = fColor;
        }
    `;

    const attribs = {
        vPosition: 0,
        vColor: 1,
    };

    const program = initShaderProgram(gl, vsSource, fsSource, attribs);

    const uProjectionMatrixLoc = gl.getUniformLocation(program, 'uMatScreenFromWorld');

    const maxQuads = 64;
    const numVertices = 4 * maxQuads;
    const bytesPerVertex = 2 * Float32Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT;
    const wordsPerQuad = bytesPerVertex; // divide by four bytes per word, but also multiply by four vertices per quad

    const vertexData = new ArrayBuffer(numVertices * bytesPerVertex);
    const vertexDataAsFloat32 = new Float32Array(vertexData);
    const vertexDataAsUint32 = new Uint32Array(vertexData);

    const vertexBuffer = gl.createBuffer();

    let numQuads = 0;

    const matScreenFromWorldCached = mat4.create();

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(attribs.vPosition);
    gl.enableVertexAttribArray(attribs.vColor);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(attribs.vPosition, 2, gl.FLOAT, false, bytesPerVertex, 0);
    gl.vertexAttribPointer(attribs.vColor, 4, gl.UNSIGNED_BYTE, true, bytesPerVertex, 8);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    const indexBuffer = createGlyphIndexBuffer(gl, maxQuads);
    gl.bindVertexArray(null);

    function setMatScreenFromWorld(matScreenFromWorld: mat4) {
        mat4.copy(matScreenFromWorldCached, matScreenFromWorld);
    }

    function addRect(x0: number, y0: number, x1: number, y1: number, color: number) {
        if (numQuads >= maxQuads) {
            flushQuads();
        }

        const i = numQuads * wordsPerQuad;

        vertexDataAsFloat32[i + 0] = x0;
        vertexDataAsFloat32[i + 1] = y0;
        vertexDataAsUint32[i + 2] = color;

        vertexDataAsFloat32[i + 3] = x1;
        vertexDataAsFloat32[i + 4] = y0;
        vertexDataAsUint32[i + 5] = color;

        vertexDataAsFloat32[i + 6] = x0;
        vertexDataAsFloat32[i + 7] = y1;
        vertexDataAsUint32[i + 8] = color;

        vertexDataAsFloat32[i + 9] = x1;
        vertexDataAsFloat32[i + 10] = y1;
        vertexDataAsUint32[i + 11] = color;

        ++numQuads;
    }

    function flushQuads() {
        if (numQuads <= 0) {
            return;
        }

        gl.useProgram(program);

        gl.bindVertexArray(vao);

        gl.uniformMatrix4fv(uProjectionMatrixLoc, false, matScreenFromWorldCached);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexDataAsFloat32, 0);

        gl.drawElements(gl.TRIANGLES, 6 * numQuads, gl.UNSIGNED_SHORT, 0);

        gl.bindVertexArray(null);

        numQuads = 0;
    }

    return {
        start: setMatScreenFromWorld,
        addRect: addRect,
        flush: flushQuads,
    };
}

function createGlyphRenderer(gl: WebGL2RenderingContext, glyphTexture: WebGLTexture): RenderGlyphs {
    const vsSource = `#version 300 es
        in vec2 vPosition;
        in vec3 vTexcoord;
        in vec4 vColor;

        uniform mat4 uMatScreenFromWorld;

        out highp vec3 fTexcoord;
        out highp vec4 fColor;

        void main() {
            fTexcoord = vTexcoord;
            fColor = vColor;
            gl_Position = uMatScreenFromWorld * vec4(vPosition, 0, 1);
        }
    `;

    const fsSource = `#version 300 es
        in highp vec3 fTexcoord;
        in highp vec4 fColor;

        uniform highp sampler2DArray uOpacity;

        out lowp vec4 fragColor;

        void main() {
            fragColor = fColor * vec4(1, 1, 1, texture(uOpacity, fTexcoord));
        }
    `;

    const attribs = {
        vPosition: 0,
        vTexcoord: 1,
        vColor: 2,
    };

    const program = initShaderProgram(gl, vsSource, fsSource, attribs);

    const uProjectionMatrixLoc = gl.getUniformLocation(program, 'uMatScreenFromWorld');
    const uOpacityLoc = gl.getUniformLocation(program, 'uOpacity');

    const maxQuads = 64;
    const numVertices = 4 * maxQuads;
    const bytesPerVertex = 2 * Float32Array.BYTES_PER_ELEMENT + 2 * Uint32Array.BYTES_PER_ELEMENT;
    const wordsPerQuad = bytesPerVertex; // divide by four bytes per word, but also multiply by four vertices per quad

    const vertexData = new ArrayBuffer(numVertices * bytesPerVertex);
    const vertexDataAsFloat32 = new Float32Array(vertexData);
    const vertexDataAsUint32 = new Uint32Array(vertexData);

    const vertexBuffer = gl.createBuffer();

    let numQuads = 0;

    const matScreenFromWorldCached = mat4.create();

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(attribs.vPosition);
    gl.enableVertexAttribArray(attribs.vTexcoord);
    gl.enableVertexAttribArray(attribs.vColor);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(attribs.vPosition, 2, gl.FLOAT, false, bytesPerVertex, 0);
    gl.vertexAttribPointer(attribs.vTexcoord, 3, gl.UNSIGNED_BYTE, false, bytesPerVertex, 8);
    gl.vertexAttribPointer(attribs.vColor, 4, gl.UNSIGNED_BYTE, true, bytesPerVertex, 12);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    const indexBuffer = createGlyphIndexBuffer(gl, maxQuads);
    gl.bindVertexArray(null);

    function setMatScreenFromWorld(matScreenFromWorld: mat4) {
        mat4.copy(matScreenFromWorldCached, matScreenFromWorld);
    }

    function addGlyph(x0: number, y0: number, x1: number, y1: number, glyphIndex: number, color: number) {
        if (numQuads >= maxQuads) {
            flushQuads();
        }

        const i = numQuads * wordsPerQuad;
        const srcBase = glyphIndex << 16;

        vertexDataAsFloat32[i + 0] = x0;
        vertexDataAsFloat32[i + 1] = y0;
        vertexDataAsUint32[i + 2] = srcBase + 256;
        vertexDataAsUint32[i + 3] = color;

        vertexDataAsFloat32[i + 4] = x1;
        vertexDataAsFloat32[i + 5] = y0;
        vertexDataAsUint32[i + 6] = srcBase + 257;
        vertexDataAsUint32[i + 7] = color;

        vertexDataAsFloat32[i + 8] = x0;
        vertexDataAsFloat32[i + 9] = y1;
        vertexDataAsUint32[i + 10] = srcBase;
        vertexDataAsUint32[i + 11] = color;

        vertexDataAsFloat32[i + 12] = x1;
        vertexDataAsFloat32[i + 13] = y1;
        vertexDataAsUint32[i + 14] = srcBase + 1;
        vertexDataAsUint32[i + 15] = color;

        ++numQuads;
    }

    function flushQuads() {
        if (numQuads <= 0) {
            return;
        }

        gl.useProgram(program);

        gl.bindVertexArray(vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, glyphTexture);
        gl.uniform1i(uOpacityLoc, 0);

        gl.uniformMatrix4fv(uProjectionMatrixLoc, false, matScreenFromWorldCached);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexDataAsFloat32, 0);

        gl.drawElements(gl.TRIANGLES, 6 * numQuads, gl.UNSIGNED_SHORT, 0);

        gl.bindVertexArray(null);

        numQuads = 0;
    }

    return {
        start: setMatScreenFromWorld,
        addGlyph: addGlyph,
        flush: flushQuads,
    };
}

function createGlyphIndexBuffer(gl: WebGL2RenderingContext, maxQuads: number): WebGLBuffer {
    const indices = new Uint16Array(maxQuads * 6);

    for (let i = 0; i < maxQuads; ++i) {
        let j = 6 * i;
        let k = 4 * i;
        indices[j + 0] = k + 0;
        indices[j + 1] = k + 1;
        indices[j + 2] = k + 2;
        indices[j + 3] = k + 2;
        indices[j + 4] = k + 1;
        indices[j + 5] = k + 3;
    }

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    return indexBuffer;
}

function createGlyphTextureFromImage(gl: WebGL2RenderingContext, image: HTMLImageElement): WebGLTexture {
    const numGlyphsX = 16;
    const numGlyphsY = 16;
    const numGlyphs = numGlyphsX * numGlyphsY;
    const srcGlyphSizeX = image.naturalWidth / numGlyphsX;
    const srcGlyphSizeY = image.naturalHeight / numGlyphsY;
    const scaleFactor = 4;
    const dstGlyphSizeX = srcGlyphSizeX * scaleFactor;
    const dstGlyphSizeY = srcGlyphSizeY * scaleFactor;

    // Rearrange the glyph data from a grid to a vertical array

    const canvas = document.createElement('canvas');
    canvas.width = dstGlyphSizeX;
    canvas.height = dstGlyphSizeY * numGlyphs;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < numGlyphsY; ++y) {
        for (let x = 0; x < numGlyphsX; ++x) {
            const sx = x * srcGlyphSizeX;
            const sy = y * srcGlyphSizeY;
            const dx = 0;
            const dy = (numGlyphsX * y + x) * dstGlyphSizeY;
            ctx.drawImage(image, sx, sy, srcGlyphSizeX, srcGlyphSizeY, dx, dy, dstGlyphSizeX, dstGlyphSizeY);
        }
    }
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = new Uint8Array(imageData.data.buffer);

    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, dstGlyphSizeX, dstGlyphSizeY, numGlyphs, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    return texture;
}

function updateAndRender(now: number, renderer: Renderer, state: State) {
    const t = now / 1000;
    const dt = (state.paused || state.tLast === undefined) ? 0 : Math.min(1 / 30, t - state.tLast);
    state.tLast = t;

    if (dt > 0) {
        updateState(state, dt);
    }

    renderScene(renderer, state);

    if (!state.paused) {
        requestAnimationFrame(now => updateAndRender(now, renderer, state));
    }
}

function updateState(state: State, dt: number) {
    const enemySpeed = 2.0;
    state.enemy.progressFraction += enemySpeed * dt;
    while (state.enemy.progressFraction >= 1) {
        state.enemy.progressFraction -= 1;
        const nodeIndexNext = state.graph.node[state.enemy.nodeIndex].next;
        if (nodeIndexNext === undefined || nodeIndexNext === state.graph.start) {
            state.enemy.nodeIndex = state.graph.goal;
        } else {
            state.enemy.nodeIndex = nodeIndexNext;
        }
    }
}

function renderScene(renderer: Renderer, state: State) {
    const screenSize = renderer.beginFrame();

    const matScreenFromWorld = mat4.create();
    setupGraphViewMatrix(state.graph.extents, screenSize, matScreenFromWorld);

    renderer.renderRects.start(matScreenFromWorld);

    if (state.pointerGridPos !== undefined) {
        const x = Math.floor(state.pointerGridPos[0]);
        const y = Math.floor(state.pointerGridPos[1]);
        if (x >= 0 && y >= 0 && x < state.graph.extents[0] - 1 && y < state.graph.extents[1] - 1) {
            renderer.renderRects.addRect(x - 0.25, y - 0.25, x + 1.25, y + 1.25, 0x10808080);
        }
    }

    drawGraph(state.graph, renderer.renderRects);

    /*
    if (state.pointerGridPos !== undefined) {
        const x = state.pointerGridPos[0];
        const y = state.pointerGridPos[1];
        const r = 0.05;
        renderer.renderRects.addRect(x - r, y - r, x + r, y + r, 0xffffffff);
    }
    */

    renderer.renderRects.flush();

    const i0 = state.enemy.nodeIndex;
    if (i0 !== undefined) {
        const i1 = state.graph.node[i0].next;
        if (i1 !== undefined) {
            const pos0 = state.graph.node[i0].coord;
            const pos1 = state.graph.node[i1].coord;

            const pos = vec2.create();
            vec2.lerp(pos, pos0, pos1, state.enemy.progressFraction);

            renderer.renderDiscs(matScreenFromWorld, [{
                position: pos,
                radius: 0.3333,
                discColor: 0xff2020ff,
                glyphIndex: 69,
                glyphColor: 0xffe0e0ff,
            }]);
        }
    }
}

function setupGraphViewMatrix(graphExtents: Coord, screenSize: vec2, matScreenFromWorld: mat4) {
    const mapSizeX = graphExtents[0];
    const mapSizeY = graphExtents[1];

    let rxMap: number, ryMap: number;
    if (screenSize[0] * mapSizeY < screenSize[1] * mapSizeX) {
        // horizontal is limiting dimension
        rxMap = mapSizeX / 2;
        ryMap = rxMap * screenSize[1] / screenSize[0];
    } else {
        // vertical is limiting dimension
        ryMap = mapSizeY / 2;
        rxMap = ryMap * screenSize[0] / screenSize[1];
    }
    const cxMap = (mapSizeX - 1) / 2;
    const cyMap = (mapSizeY - 1) / 2;

    mat4.ortho(matScreenFromWorld, cxMap - rxMap, cxMap + rxMap, cyMap - ryMap, cyMap + ryMap, 1, -1);
}

function graphCoordsFromCanvasPos(graphExtents: Coord, screenSize: vec2, pos: vec2): vec2 {
    const mapSizeX = graphExtents[0];
    const mapSizeY = graphExtents[1];

    let screenGridSizeX: number, screenGridSizeY: number;
    if (screenSize[0] * mapSizeY < screenSize[1] * mapSizeX) {
        // horizontal is limiting dimension
        screenGridSizeX = mapSizeX;
        screenGridSizeY = screenGridSizeX * screenSize[1] / screenSize[0];
    } else {
        // vertical is limiting dimension
        screenGridSizeY = mapSizeY;
        screenGridSizeX = screenGridSizeY * screenSize[0] / screenSize[1];
    }
    const screenOffsetX = (screenGridSizeX - mapSizeX) / 2 + 0.5;
    const screenOffsetY = (screenGridSizeY - mapSizeY) / 2 + 0.5;

    const gridX = pos[0] * (screenGridSizeX / screenSize[0]) - screenOffsetX;
    const gridY = pos[1] * (screenGridSizeY / screenSize[1]) - screenOffsetY;

    return vec2.fromValues(gridX, gridY);
}

function renderTextLines(renderer: Renderer, screenSize: vec2, lines: Array<string>) {
    let maxLineLength = 0;
    for (const line of lines) {
        maxLineLength = Math.max(maxLineLength, line.length);
    }

    const minCharsX = 40;
    const minCharsY = 22;
    const scaleLargestX = Math.max(1, Math.floor(screenSize[0] / (8 * minCharsX)));
    const scaleLargestY = Math.max(1, Math.floor(screenSize[1] / (16 * minCharsY)));
    const scaleFactor = Math.min(scaleLargestX, scaleLargestY);
    const pixelsPerCharX = 8 * scaleFactor;
    const pixelsPerCharY = 16 * scaleFactor;
    const linesPixelSizeX = maxLineLength * pixelsPerCharX;
    const numCharsX = screenSize[0] / pixelsPerCharX;
    const numCharsY = screenSize[1] / pixelsPerCharY;
    const offsetX = Math.floor((screenSize[0] - linesPixelSizeX) / -2) / pixelsPerCharX;
    const offsetY = (lines.length + 2) - numCharsY;

    const matScreenFromTextArea = mat4.create();
    mat4.ortho(
        matScreenFromTextArea,
        offsetX,
        offsetX + numCharsX,
        offsetY,
        offsetY + numCharsY,
        1,
        -1);
    renderer.renderGlyphs.start(matScreenFromTextArea);

    const colorText = 0xffeeeeee;
    const colorBackground = 0xe0555555;

    // Draw a stretched box to make a darkened background for the text.
    renderer.renderGlyphs.addGlyph(
        -1, -1, maxLineLength + 1, lines.length + 1,
        219,
        colorBackground
    );

    for (let i = 0; i < lines.length; ++i) {
        const row = lines.length - (1 + i);
        for (let j = 0; j < lines[i].length; ++j) {
            const col = j;
            const ch = lines[i];
            if (ch === ' ') {
                continue;
            }
            const glyphIndex = lines[i].charCodeAt(j);
            renderer.renderGlyphs.addGlyph(
                col, row, col + 1, row + 1,
                glyphIndex,
                colorText
            );
        }
    }

    renderer.renderGlyphs.flush();
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement) {
    const parentElement = canvas.parentNode as HTMLElement;
    const rect = parentElement.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
}

function initShaderProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string, attribs: Record<string, number>): WebGLProgram {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    for (const attrib in attribs) {
        gl.bindAttribLocation(program, attribs[attrib], attrib);
    }

    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program))!;
    }

    return program;
}

function loadShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }

    return shader;
}

function randomInRange(n: number): number {
    return Math.floor(Math.random() * n);
}

function drawGraph(graph: Graph, renderRects: RenderRects) {
    const r = 0.05;

    const colorPath = 0xff10d0d0;
    const colorLoop = 0xff408020;

    for (let i = 0; i < graph.node.length; ++i) {
        const node = graph.node[i];

        if (node.next === undefined && i !== graph.start)
            continue;

        const color = (node.group === 0) ? colorPath : colorLoop;

        const x0 = node.coord[0] - r;
        const x1 = node.coord[0] + r;
        const y0 = node.coord[1] - r;
        const y1 = node.coord[1] + r;

        renderRects.addRect(x0, y0, x1, y1, color);
    }

    for (let i0 = 0; i0 < graph.node.length; ++i0) {
        const node0 = graph.node[i0];

        const i1 = node0.next;
        if (i1 === undefined)
            continue;

        const node1 = graph.node[i1];

        const color = (node0.group === 0 && node1.group === 0) ? colorPath : colorLoop;

        let x0 = Math.min(node0.coord[0], node1.coord[0]);
        let x1 = Math.max(node0.coord[0], node1.coord[0]);
        let y0 = Math.min(node0.coord[1], node1.coord[1]);
        let y1 = Math.max(node0.coord[1], node1.coord[1]);

        if (node0.coord[0] === node1.coord[0]) {
            x0 -= r;
            x1 += r;
            y0 += r;
            y1 -= r;
        } else {
            x0 += r;
            x1 -= r;
            y0 -= r;
            y1 += r;
        }

        renderRects.addRect(x0, y0, x1, y1, color);
    }
}

function graphNodeIndexFromCoord(graph: Graph, x: number, y: number): number | undefined {
    if (x < 0 || y < 0)
        return undefined;

    if (x >= graph.extents[0] || y >= graph.extents[1])
        return undefined;

    return x * graph.extents[1] + y;
}

function createGraph(sizeX: number, sizeY: number): Graph {
    let graph: Graph = {
        node: [],
        extents: [sizeX, sizeY],
        start: 0,
        goal: 0
    };

    // Build a grid, for now, and a path in it.

    for (let x = 0; x < sizeX; ++x) {
        for (let y = 0; y < sizeY; ++y) {
            const node: Node = {
                coord: [x, y],
                next: undefined,
                group: 0,
            };
            graph.node.push(node);
        }
    }

    generateZigZagPath(graph);

    computeGroups(graph);
    shuffle(graph);
    join(graph);

    return graph;
}

function generateZigZagPath(graph: Graph) {
    for (const node of graph.node) {
        const x = node.coord[0];
        const y = node.coord[1];

        if ((y & 1) === 0) {
            if (x > 0) {
                node.next = (x - 1) * graph.extents[1] + y;
            } else if (y > 0) {
                node.next = x * graph.extents[1] + (y - 1);
            } else {
                node.next = undefined;
            }
        } else {
            if (x < graph.extents[0] - 1) {
                node.next = (x + 1) * graph.extents[1] + y;
            } else if (y > 0) {
                node.next = x * graph.extents[1] + (y - 1);
            } else {
                node.next = undefined;
            }
        }
    }

    if ((graph.extents[1] & 1) === 0) {
        graph.goal = graph.extents[1] - 1;
    } else {
        graph.goal = graph.extents[0] * graph.extents[1] - 1;
    }
}

function shuffle(graph: Graph) {
    const numShuffles = 4 * (graph.extents[0] - 1) * (graph.extents[1] - 1);
    for (let n = numShuffles; n > 0; --n) {
        const x = randomInRange(graph.extents[0] - 1);
        const y = randomInRange(graph.extents[1] - 1);

        tryRotate(graph, [x, y]);
    }
}

function tryRotate(graph: Graph, coord: Coord): boolean {
    // Need to be in a square that has edges on opposite sides

    let i00 = graphNodeIndexFromCoord(graph, coord[0], coord[1]);
    let i10 = graphNodeIndexFromCoord(graph, coord[0] + 1, coord[1]);
    let i01 = graphNodeIndexFromCoord(graph, coord[0], coord[1] + 1);
    let i11 = graphNodeIndexFromCoord(graph, coord[0] + 1, coord[1] + 1);

    if (i00 === undefined || i10 === undefined || i01 === undefined || i11 === undefined)
        return false;

    // Reorient to cut down on the number of distinct cases to consider.
    // We are aiming to have an edge from (0, 0) to (1, 0),
    // if possible on the main path and not a loop.

    if (graph.node[i00].next === i01 || graph.node[i01].next === i00) {
        [i10, i01] = [i01, i10];
    }

    if (graph.node[i01].group === 0) {
        [i00, i01] = [i01, i00];
        [i10, i11] = [i11, i10];
    }

    if (graph.node[i10].next === i00) {
        [i00, i10] = [i10, i00];
        [i01, i11] = [i11, i01];
    }

    let node00 = graph.node[i00];
    let node10 = graph.node[i10];
    let node01 = graph.node[i01];
    let node11 = graph.node[i11];

    // Have to have two parallel edges: one from (0, 0) to (1, 0),
    // and another either from (0, 1) to (1, 1) or from (1, 1) to (0, 1).

    if (node00.next !== i10)
        return false;

    if (node01.next !== i11 && node11.next !== i01)
        return false;

    if (node01.next === i00)
        return false;

    if (node10.next === i11)
        return false;

    if (node11.next === i10)
        return false;

    if (node11.next === i01) {
        // Simple: the two edges are going in opposite directions

        node00.next = i01;
        node11.next = i10;
        computeGroups(graph);
    } else {
        // Complex: the two edges are going the same direction, so something has to be reversed

        if (node01.group != 0) {
            reverse(graph, i11, i01);
            node00.next = i01;
            node11.next = i10;
            computeGroups(graph);
        } else if (before(graph, i10, i01)) {
            reverse(graph, i10, i01);
            node00.next = i01;
            node10.next = i11;
            computeGroups(graph);
        } else {
            reverse(graph, i11, i00);
            node01.next = i00;
            node11.next = i10;
            computeGroups(graph);
        }
    }

    return true;
}

function computeGroups(graph: Graph) {
    // Initialize all nodes to no group

    for (const node of graph.node) {
        node.group = undefined;
    }

    // Trace the Hamiltonian path and put all of its nodes in group 0

    let group = 0;

    for (let i: number | undefined = graph.goal; i !== undefined && graph.node[i].group === undefined; i = graph.node[i].next) {
        graph.node[i].group = group;
    }

    ++group;

    // Put any nodes that weren't reached into additional groups

    for (let i = 0; i < graph.node.length; ++i) {
        for (let j: number | undefined = i; j !== undefined && graph.node[j].group === undefined; j = graph.node[j].next) {
            graph.node[j].group = group;
        }

        ++group;
    }
}

function before(graph: Graph, i0: number, i1: number): boolean {
    if (i0 === undefined)
        return false;

    for (let i = graph.node[i0].next; i !== i0 && i !== undefined; i = graph.node[i].next) {
        if (i === i1) {
            return true;
        }
    }

    return false;
}

function reverse(graph: Graph, i0: number, i1: number) {
    let i = i0;
    let iPrev = undefined;

    for (; ;) {
        const iNext = graph.node[i].next;
        graph.node[i].next = iPrev;

        if (i === i1)
            break;

        iPrev = i;
        i = iNext as number;
    }
}

function join(graph: Graph) {
    const coords: Array<Coord> = [];
    for (let x = 0; x < graph.extents[0] - 1; ++x) {
        for (let y = 0; y < graph.extents[1] - 1; ++y) {
            coords.push([x, y]);
        }
    }

    while (coords.length > 0) {
        const i = randomInRange(coords.length);
        const coord = coords[i];
        coords[i] = coords[coords.length - 1];
        --coords.length;

        const i00 = graphNodeIndexFromCoord(graph, coord[0], coord[1]);
        const i10 = graphNodeIndexFromCoord(graph, coord[0] + 1, coord[1]);
        const i01 = graphNodeIndexFromCoord(graph, coord[0], coord[1] + 1);
        const i11 = graphNodeIndexFromCoord(graph, coord[0] + 1, coord[1] + 1);

        if (i00 === undefined || i10 === undefined || i01 === undefined || i11 === undefined) {
            continue;
        }

        const node00 = graph.node[i00];
        const node10 = graph.node[i10];
        const node01 = graph.node[i01];
        const node11 = graph.node[i11];

        if (node00.group !== node10.group ||
            node00.group !== node01.group ||
            node10.group !== node11.group ||
            node01.group !== node11.group) {
            tryRotate(graph, coord);
        }
    }
}
