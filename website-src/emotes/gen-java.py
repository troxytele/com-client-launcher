#!/usr/bin/env python3
"""Writes EmoteClips.java (the mod) from the clip files in this folder, so the game plays exactly what the previews show.
Usage: python3 gen-java.py <path to EmoteClips.java>"""
import json, glob, os, sys

here = os.path.dirname(os.path.abspath(__file__))
clips = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(here, "*.json")))]
f = lambda x: f"{x:.4f}F".replace("-0.0000F", "0F")
out = ['''package com.client.emote;

import java.util.Map;

/**
 * Keyframed emotes (made from the clip files in the launcher repo, website-src/emotes/*.json: don't edit by hand,
 * run gen-java.py). Every track loops over the clip's period and is smooth through each key (Catmull-Rom).
 * Tracks: head, body, rightArm, leftArm, rightLeg, leftLeg = {pitch, yaw, roll}; rightElbow, leftElbow, rightKnee,
 * leftKnee = {bend, twist}; root = {x, y, z, ...} in pixels (the whole player moves).
 */
public final class EmoteClips {
    public record Clip(String id, float period, Map<String, float[][]> keys) {
    }

    private EmoteClips() {
    }

    public static final Map<String, Clip> ALL = Map.ofEntries(''']
items = []
for c in clips:
    tracks = []
    for name, keys in c["keys"].items():
        rows = ", ".join("{" + ", ".join(f(v) for v in k) + "}" for k in keys)
        tracks.append(f'                    Map.entry("{name}", new float[][]{{{rows}}})')
    items.append(f'            Map.entry("{c["id"]}", new Clip("{c["id"]}", {f(c["period"])}, Map.ofEntries(\n' + ",\n".join(tracks) + ")))")
out.append(",\n".join(items) + ");")
out.append('''
    /** A track's values at time t (seconds), smooth through the looping keys. */
    public static float[] sample(float[][] keys, float period, float t) {
        int n = keys.length;
        if (n == 1) {
            float[] o = new float[keys[0].length - 1];
            System.arraycopy(keys[0], 1, o, 0, o.length);
            return o;
        }
        t = ((t % period) + period) % period;
        int i = n - 1;
        for (int k = 0; k < n; k++) {
            if (keys[k][0] > t) {
                i = k - 1;
                break;
            }
        }
        if (i < 0) {
            i = n - 1;
        }
        float[] p0 = keys[Math.floorMod(i - 1, n)], p1 = keys[i], p2 = keys[(i + 1) % n], p3 = keys[(i + 2) % n];
        float t1 = p1[0], t2 = p2[0];
        if (t2 <= t1) {
            t2 += period;
        }
        float tt = t < t1 ? t + period : t;
        float u = (tt - t1) / (t2 - t1 == 0 ? 1 : t2 - t1);
        float[] o = new float[p1.length - 1];
        for (int d = 1; d < p1.length; d++) {
            float a = p0[d], b = p1[d], c = p2[d], e = p3[d];
            o[d - 1] = 0.5F * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - e) * u * u + (-a + 3 * b - 3 * c + e) * u * u * u);
        }
        return o;
    }
}
''')
open(sys.argv[1], "w").write("\n".join(out))
print("wrote", len(clips), "clips")
