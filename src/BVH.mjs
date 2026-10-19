/**
 * A bounding volume hierarchy: a binary tree of axis-aligned boxes over a
 * scene's primitives, so a ray only tests the few primitives in the boxes it
 * passes through.
 *
 * Nodes are packed flat, 32 bytes each, as the shader reads them: the
 * box's min corner (3 floats), then a u32 that is the first primitive (for
 * a leaf) or the left child (for an inner node, whose right child follows
 * it), then the max corner, then a u32 count of primitives (0 for an inner
 * node). Node 0 is the root. The builder reorders the primitives so each
 * leaf's are consecutive; order[i] is the original index of the i-th.
 *
 * It splits each node where the surface area heuristic says rays will do
 * the least work, trying 12 evenly spaced planes on each axis.
 */
export class BVH {

    static NODE_BYTES = 32;

    #nodes;
    #order;
    #nodeCount;

    /**
     * @param {ArrayBuffer} nodes
     * @param {number} nodeCount
     * @param {Uint32Array} order
     */
    constructor(nodes, nodeCount, order) {
        this.#nodes = nodes;
        this.#nodeCount = nodeCount;
        this.#order = order;
    }

    /** The packed nodes, BVH.NODE_BYTES each. */
    get nodes() {
        return this.#nodes;
    }

    get nodeCount() {
        return this.#nodeCount;
    }

    /** order[i] is the original index of the i-th primitive in leaf order. */
    get order() {
        return this.#order;
    }

    /**
     * Builds the tree over primitives given by their bounding boxes.
     * @param {Float32Array | Float64Array} mins min corners, 3 per primitive
     * @param {Float32Array | Float64Array} maxs max corners, 3 per primitive
     * @param {{ maxLeafSize?: number }} [options] leaves are kept to this
     *   size unless their primitives can't be told apart
     */
    static build(mins, maxs, { maxLeafSize = 4 } = {}) {

        const count = mins.length / 3;
        const order = new Uint32Array(count);
        for (let i = 0; i < count; ++i)
            order[i] = i;

        const centroids = new Float64Array(count * 3);
        for (let i = 0; i < count * 3; ++i)
            centroids[i] = (mins[i] + maxs[i]) * 0.5;

        /** @type {{ min: number[], max: number[], first: number, count: number }[]} */
        const nodes = [];

        /** @type {(first: number, n: number) => number} */
        const addNode = (first, n) => {

            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];

            for (let i = first; i < first + n; ++i) {
                const p = order[i];
                for (let a = 0; a < 3; ++a) {
                    min[a] = Math.min(min[a], mins[p * 3 + a]);
                    max[a] = Math.max(max[a], maxs[p * 3 + a]);
                }
            }

            nodes.push({ min, max, first, count: n });
            return nodes.length - 1;
        };

        addNode(0, count);
        const stack = count > maxLeafSize ? [0] : [];

        const BINS = 12;
        const bin_min = new Float64Array(BINS * 3);
        const bin_max = new Float64Array(BINS * 3);
        const bin_count = new Uint32Array(BINS);
        const right_area = new Float64Array(BINS);
        const right_count = new Uint32Array(BINS);

        while (stack.length > 0) {

            const node = nodes[/** @type {number} */ (stack.pop())];
            const first = node.first;
            const n = node.count;

            // The bounds of the centroids, which the bins divide.
            const cmin = [Infinity, Infinity, Infinity];
            const cmax = [-Infinity, -Infinity, -Infinity];
            for (let i = first; i < first + n; ++i) {
                const p = order[i];
                for (let a = 0; a < 3; ++a) {
                    cmin[a] = Math.min(cmin[a], centroids[p * 3 + a]);
                    cmax[a] = Math.max(cmax[a], centroids[p * 3 + a]);
                }
            }

            let best_cost = Infinity;
            let best_axis = -1;
            let best_split = 0;

            for (let axis = 0; axis < 3; ++axis) {

                const extent = cmax[axis] - cmin[axis];
                if (!(extent > 0.0))
                    continue;

                bin_min.fill(Infinity);
                bin_max.fill(-Infinity);
                bin_count.fill(0);

                const scale = BINS / extent;
                for (let i = first; i < first + n; ++i) {
                    const p = order[i];
                    const b = Math.min(BINS - 1, Math.floor((centroids[p * 3 + axis] - cmin[axis]) * scale));
                    bin_count[b]++;
                    for (let a = 0; a < 3; ++a) {
                        bin_min[b * 3 + a] = Math.min(bin_min[b * 3 + a], mins[p * 3 + a]);
                        bin_max[b * 3 + a] = Math.max(bin_max[b * 3 + a], maxs[p * 3 + a]);
                    }
                }

                // Sweep from the right, recording each suffix's area and count.
                const box = BVH.#emptyBox();
                let total = 0;
                for (let b = BINS - 1; b > 0; --b) {
                    BVH.#grow(box, bin_min, bin_max, b, bin_count[b]);
                    total += bin_count[b];
                    right_area[b] = BVH.#area(box);
                    right_count[b] = total;
                }

                // Then from the left, costing a split before each bin.
                const left = BVH.#emptyBox();
                let left_count = 0;
                for (let b = 1; b < BINS; ++b) {
                    BVH.#grow(left, bin_min, bin_max, b - 1, bin_count[b - 1]);
                    left_count += bin_count[b - 1];
                    if (left_count == 0 || right_count[b] == 0)
                        continue;
                    const cost = left_count * BVH.#area(left) + right_count[b] * right_area[b];
                    if (cost < best_cost) {
                        best_cost = cost;
                        best_axis = axis;
                        best_split = cmin[axis] + b / scale;
                    }
                }
            }

            const parent_area = BVH.#area({ min: node.min, max: node.max });
            const leaf_cost = n * parent_area;

            let mid;
            if (best_axis < 0) {
                // Every centroid is in the same place: no plane separates
                // them, so halve the list if it's too long for a leaf.
                if (n <= maxLeafSize)
                    continue;
                mid = first + (n >> 1);
            }
            else {
                // Splitting costs a box test, worth about one primitive.
                if (n <= maxLeafSize && best_cost + parent_area >= leaf_cost)
                    continue;

                // Partition so the left side's centroids are below the split.
                let i = first;
                let j = first + n - 1;
                while (i <= j) {
                    if (centroids[order[i] * 3 + best_axis] < best_split)
                        ++i;
                    else {
                        [order[i], order[j]] = [order[j], order[i]];
                        --j;
                    }
                }
                mid = i;
                if (mid == first || mid == first + n)
                    mid = first + (n >> 1);
            }

            const left_index = addNode(first, mid - first);
            addNode(mid, first + n - mid);

            node.first = left_index;
            node.count = 0;

            for (const child of [left_index, left_index + 1]) {
                if (nodes[child].count > 1)
                    stack.push(child);
            }
        }

        const buffer = new ArrayBuffer(Math.max(nodes.length, 1) * BVH.NODE_BYTES);
        const floats = new Float32Array(buffer);
        const uints = new Uint32Array(buffer);

        nodes.forEach((node, i) => {
            const o = i * 8;
            floats.set(node.min, o);
            uints[o + 3] = node.first;
            floats.set(node.max, o + 4);
            uints[o + 7] = node.count;
        });

        // With no primitives there's nothing to traverse: the one node is
        // a box of no size at the origin, which the caller must deal with
        // (Scene makes it a leaf of one primitive that nothing hits).
        if (count == 0) {
            floats.fill(0.0);
            uints[3] = 0;
            uints[7] = 0;
        }

        return new BVH(buffer, Math.max(nodes.length, 1), order);
    }

    static #emptyBox() {
        return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    }

    /**
     * @param {{ min: number[], max: number[] }} box
     * @param {Float64Array} bin_min
     * @param {Float64Array} bin_max
     * @param {number} b
     * @param {number} count
     */
    static #grow(box, bin_min, bin_max, b, count) {
        if (count == 0)
            return;
        for (let a = 0; a < 3; ++a) {
            box.min[a] = Math.min(box.min[a], bin_min[b * 3 + a]);
            box.max[a] = Math.max(box.max[a], bin_max[b * 3 + a]);
        }
    }

    /** @param {{ min: number[], max: number[] }} box */
    static #area(box) {
        const dx = box.max[0] - box.min[0];
        const dy = box.max[1] - box.min[1];
        const dz = box.max[2] - box.min[2];
        if (!(dx >= 0.0 && dy >= 0.0 && dz >= 0.0))
            return 0.0;
        return dx * dy + dy * dz + dz * dx;
    }
}
