import { test } from "node:test";
import assert from "node:assert/strict";
import { BVH } from "../../src/index.mjs";
import { random } from "./helpers.mjs";

// Random boxes: mostly small, some long and thin, a few huge.
function randomBoxes(count, seed) {

    const next = random(seed);
    const mins = new Float64Array(count * 3);
    const maxs = new Float64Array(count * 3);

    for (let i = 0; i < count; ++i) {
        const size = next() < 0.05 ? 50.0 : next() < 0.2 ? 5.0 : 0.3;
        for (let a = 0; a < 3; ++a) {
            const c = (next() - 0.5) * 40.0;
            const half = size * next();
            mins[i * 3 + a] = c - half;
            maxs[i * 3 + a] = c + half;
        }
    }

    return { mins, maxs };
}

function readNodes(bvh) {

    const f = new Float32Array(bvh.nodes);
    const u = new Uint32Array(bvh.nodes);

    return Array.from({ length: bvh.nodeCount }, (_, i) => ({
        min: [f[i * 8], f[i * 8 + 1], f[i * 8 + 2]],
        first: u[i * 8 + 3],
        max: [f[i * 8 + 4], f[i * 8 + 5], f[i * 8 + 6]],
        count: u[i * 8 + 7],
    }));
}

function contains(outer, inner_min, inner_max) {
    // The nodes are stored as 32-bit floats, so allow for rounding.
    return [0, 1, 2].every((a) =>
        outer.min[a] <= inner_min[a] + 1e-4 * Math.max(1, Math.abs(inner_min[a])) &&
        outer.max[a] >= inner_max[a] - 1e-4 * Math.max(1, Math.abs(inner_max[a])));
}

// Walks the tree from the root, checking each node's box holds what's
// below it, and returns how often each primitive was found in a leaf.
function walk(bvh, mins, maxs, maxLeafSize) {

    const nodes = readNodes(bvh);
    const seen = new Uint32Array(bvh.order.length);
    const stack = [0];

    while (stack.length > 0) {

        const node = nodes[stack.pop()];

        if (node.count > 0) {
            assert.ok(node.count <= maxLeafSize, `leaf of ${node.count}`);
            for (let i = node.first; i < node.first + node.count; ++i) {
                const p = bvh.order[i];
                seen[p]++;
                assert.ok(contains(node, mins.subarray(p * 3, p * 3 + 3), maxs.subarray(p * 3, p * 3 + 3)), `leaf holds primitive ${p}`);
            }
        }
        else {
            for (const child of [node.first, node.first + 1]) {
                assert.ok(child < nodes.length && child > 0, `child ${child} exists`);
                assert.ok(contains(node, nodes[child].min, nodes[child].max), "a node holds its children");
                stack.push(child);
            }
        }
    }

    return seen;
}

test("every primitive is in exactly one leaf, inside every box above it", () => {

    for (const count of [1, 2, 3, 5, 17, 100, 2000]) {

        const { mins, maxs } = randomBoxes(count, count);
        const bvh = BVH.build(mins, maxs, { maxLeafSize: 4 });
        const seen = walk(bvh, mins, maxs, 4);

        assert.deepEqual([...seen], new Array(count).fill(1), `${count} primitives`);
        assert.deepEqual([...bvh.order].sort((a, b) => a - b), [...Array(count).keys()], "order is a permutation");
    }
});

test("primitives that can't be told apart are still split into small leaves", () => {

    const count = 50;
    const mins = new Float64Array(count * 3).fill(-1.0);
    const maxs = new Float64Array(count * 3).fill(1.0);

    const bvh = BVH.build(mins, maxs, { maxLeafSize: 4 });
    const seen = walk(bvh, mins, maxs, 4);

    assert.deepEqual([...seen], new Array(count).fill(1));
});

test("the tree is shallow enough for the shader's 64-entry stack", () => {

    const { mins, maxs } = randomBoxes(20000, 9);
    const nodes = readNodes(BVH.build(mins, maxs));

    let deepest = 0;
    const stack = [[0, 1]];
    while (stack.length > 0) {
        const [n, depth] = stack.pop();
        deepest = Math.max(deepest, depth);
        if (nodes[n].count == 0)
            stack.push([nodes[n].first, depth + 1], [nodes[n].first + 1, depth + 1]);
    }

    assert.ok(deepest < 64, `depth ${deepest}`);
});

test("splitting puts separate clusters in separate subtrees", () => {

    // Two clusters far apart: the root should divide them.
    const count = 40;
    const mins = new Float64Array(count * 3);
    const maxs = new Float64Array(count * 3);
    for (let i = 0; i < count; ++i) {
        const x = (i < count / 2 ? -100 : 100) + (i % 7);
        mins.set([x, 0, 0], i * 3);
        maxs.set([x + 0.5, 0.5, 0.5], i * 3);
    }

    const bvh = BVH.build(mins, maxs);
    const nodes = readNodes(bvh);
    const [left, right] = [nodes[nodes[0].first], nodes[nodes[0].first + 1]];

    assert.ok(left.max[0] < 0 || right.max[0] < 0, "one side is the left cluster");
    assert.ok(left.min[0] > 0 || right.min[0] > 0, "the other is the right cluster");
});

test("an empty tree is one node with nothing in it", () => {

    const bvh = BVH.build(new Float64Array(0), new Float64Array(0));

    assert.equal(bvh.nodeCount, 1);
    assert.equal(bvh.order.length, 0);
});
