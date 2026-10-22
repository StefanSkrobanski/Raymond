# Raymond's BVH

Every ray Raymond traces, whether a camera path, a shadow ray, a photon or a
raycast on the CPU, has to find the nearest thing it hits among what can be
hundreds of thousands of primitives (the pool has 78,346). Testing them all
would be hopeless, so the primitives sit in a **bounding volume hierarchy**:
a binary tree of axis-aligned boxes. A ray that misses a box skips everything
inside it.

The code is `src/BVH.mjs` (building), `Scene.pack()` (feeding it and laying
out the primitives), `trace()` in `src/shaders.mjs` (the GPU's traversal) and
`Scene.raycast()` (the CPU's, the same traversal over the same data).

```
                    root box
                 ┌─────┴──────┐
             left box      right box
            ┌───┴───┐      ┌───┴───┐
          leaf    leaf   leaf    leaf      ← up to 4 primitives each
         [0..3]  [4..6] [7..10] [11..12]   ← consecutive in the primitive buffer
```

## What goes in

`Scene.pack()` turns each sphere, quad, box and mesh triangle into one 64-byte
primitive and works out its bounding box. Volumes (fog) stay **out** of the
tree: rays pass through them rather than stopping, so the shader handles them
separately (`scatter_in_volumes()`, `transmittance()`), and they're stored
after the tree's primitives.

`BVH.build(mins, maxs)` sees only the boxes: two flat arrays of 3 numbers per
primitive. It never needs to know what the primitives are.

## Building the tree

The build is top-down. It starts with one node holding everything and splits
nodes until they're small enough, using a stack of nodes still to split rather
than recursion.

### Choosing a split: the surface area heuristic

For each node, the builder needs a plane that divides its primitives into two
groups that rays will find cheap to search. The **surface area heuristic**
(SAH) estimates that cost. A random ray that passes through a box passes
through a smaller box inside it with probability roughly proportional to
their surface areas. So a split into a left group (N_L primitives, box
area A_L) and a right group (N_R, A_R) costs about

```
cost(split) = A_L × N_L + A_R × N_R
```

which is the expected number of primitive tests, relative to the parent's
area. Cheap splits are ones that make small boxes round many primitives.

### Binning

Trying every possible plane would be slow, so the builder **bins** them. On
each axis it takes the extent of the primitives' *centroids* (not their
boxes), divides it into **32 equal bins**, and drops each primitive into the
bin its centroid falls in, growing that bin's box and count.

```
centroids:   ·  · ·    ·· ·  ·      ·   ·· ·
bins:       |  0  |  1  |  2  |  3  | ... | 31 |
candidate splits: between each pair of bins (31 per axis)
```

Two sweeps then cost all 31 splits on that axis in linear time:

1. **From the right:** grow a box bin by bin, recording each suffix's area
   and count (`right_area[b]`, `right_count[b]`).
2. **From the left:** grow a second box bin by bin, and at each boundary cost
   `left_count × area(left) + right_count[b] × right_area[b]`.

The cheapest split over all three axes wins. Primitives are then partitioned
in place, centroids below the plane to the left. Swapping within the node's
range of `order` keeps every node's primitives consecutive.

### When to stop

- A node with more than 4 primitives (`maxLeafSize`) is always split.
- A node with 4 or fewer is split only if the SAH says it pays:
  `best_cost + parent_area < N × parent_area`. The extra `parent_area`
  counts the cost of testing the two children's boxes, taking a box test to
  cost about the same as one primitive.
- If every centroid is in the same place, no plane can separate them. A
  node that's still too big is then halved down the middle of its list, so
  even a pile of identical triangles ends up in small leaves (a unit test
  checks this).
- If the best plane leaves one side empty (possible with floating-point
  edge cases), the node is halved too.

### Why 32 bins

It was 12. Going to 32 made the Menger sponge render about 10% faster on
SwiftShader, left the other scenes level within noise, and slowed packing by
5–15% (the pool's goes from about 0.7 to 0.8 seconds). Leaves of 2 or 8
instead of 4 made no measurable difference.

## The node layout

Nodes are packed flat, **32 bytes** each, exactly as the shader's `Node`
struct reads them:

```
 bytes 0–11   min.x, min.y, min.z   (f32)   the box's min corner
 bytes 12–15  first                 (u32)   leaf: its first primitive
                                            inner: its left child (the right is first + 1)
 bytes 16–27  max.x, max.y, max.z   (f32)   the box's max corner
 bytes 28–31  count                 (u32)   leaf: how many primitives (> 0)
                                            inner: 0
```

```wgsl
struct Node {
    min: vec3f, first: u32,
    max: vec3f, count: u32,
}
```

Each `vec3f` plus a `u32` fills 16 bytes, so the struct has no padding and
the whole thing is two `vec4`-sized loads. Node 0 is the root. The two
children of an inner node are always added together, so they're adjacent
and the node needs only one index.

After the build, `bvh.order[i]` is the original index of the i-th primitive
in leaf order. `Scene.pack()` writes the primitive buffer in that order, so a
leaf's primitives are `first … first + count − 1` and can be read straight
off.

### The empty scene

WebGPU can't bind an empty buffer. With no primitives the builder returns one
node, a box of no size at the origin, and `Scene.pack()` makes it a leaf of
one primitive of kind `NONE`, which nothing hits.

## Traversal on the GPU

`trace(o, d, t_max, any_hit)` in `src/shaders.mjs`:

```
inv = 1 / safe(d)                       // reciprocals, with zeros nudged off
if the ray misses the root's box: return a miss

current = root, stack empty
loop:
    node = nodes[current]
    if node is a leaf:
        test each primitive, keeping the nearest hit (shrinking t_max)
        with any_hit (shadow rays), return at the first hit
    else:
        t_left  = slabs(left child)     // entry distance, or INF
        t_right = slabs(right child)
        if the ray enters either:
            go into the nearer one
            if it enters both, push the farther one
            continue
    pop the next node, or stop if the stack is empty
```

Details that matter:

- **Nearer child first.** Hits in the nearer child shrink `hit.t`, and
  `slabs()` is given `hit.t` as its limit. So when the farther child is
  popped, if its box starts beyond the hit found so far, it's skipped without
  looking inside.
- **The slab test** (`slabs()`) intersects the ray with the three pairs of
  planes bounding the box: `t0 = (min − o) × inv`, `t1 = (max − o) × inv`,
  entry = the largest of the per-axis minimums (and 0), exit = the smallest
  of the per-axis maximums (and `t_max`). It returns the entry distance, or
  `INF` for a miss. `safe()` replaces zero direction components with ±1e-20
  first, so the reciprocal is huge rather than infinite: GPUs needn't handle
  infinities and NaNs consistently.
- **The stack** is a `array<u32, 64>` in registers or private memory, and
  pushes stop at 64. A binary tree only needs one entry per level, so 64 is
  plenty for a balanced tree; a unit test builds one over 20,000 random
  boxes and checks it's well under 64 deep.
- **Shadow rays** (`occluded()`) pass `any_hit = true` and stop at the first
  primitive they hit, wherever it is, since any blocker will do.
- **Primitive tests** (`intersect()`) switch on the kind: sphere (quadratic),
  quad (plane, then the two edge coordinates), box (slabs in the box's own
  space, so it can be rotated) and triangle (Möller–Trumbore).

## Traversal on the CPU

`Scene.raycast()` walks the same packed nodes and primitives (as
`Float32Array`/`Uint32Array` views), with the same slab test and the same
intersection maths, pushing the nearer child last so it's popped first. Tap
to focus, the scene tests and the browser test "the GPU sees what the CPU
raycast sees" all rely on the two agreeing exactly. **When changing an
intersection test or the traversal, change both.**

## Tests

`tests/unit/bvh.test.mjs`:

- every primitive is in exactly one leaf, and inside every box above it;
- primitives that can't be told apart are still split into small leaves;
- the tree is shallow enough for the shader's 64-entry stack;
- splitting puts separate clusters in separate subtrees;
- an empty tree is one node with nothing in it.

The browser tests then check the GPU's traversal against the CPU's
(`albedo`, `normal` and `depth` views against `Scene.raycast`).

## Measuring it

`node tools/bench.mjs [scene ids]` renders demo scenes on SwiftShader and
prints the primitives, scene build and pack times, and millions of paths per
second. Runs vary by about ±5%, so compare several runs, alternating between
the versions being compared.

What the measurements showed, on SwiftShader at least: the Cornell box (8
primitives) is only about 40% faster than the Menger sponge (36,098), so
traversal isn't where most of the time goes. Shading, sampling and
unnecessary work are. Two changes to the traversal didn't help there:

- **A 32-entry stack** instead of 64: no difference.
- **Reusing child nodes** already loaded for the slab test, instead of
  loading them again when descending: slightly slower. On a CPU, memory
  reads are cheap and copying the extra struct isn't.

A 64-byte node that holds both children's boxes, so one load serves a
whole step, is the usual next move for real GPUs, where memory bandwidth is
what limits traversal. It would change the format here, in the shader and
in `Scene.raycast()` together, and couldn't be measured on SwiftShader, so
it hasn't been done.
