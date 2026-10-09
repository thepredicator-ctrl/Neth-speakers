# Neth Speakers — Physics Model Documentation

This document describes every equation, approximation and default used by the
simulation engine. All internal computation uses SI units (m, kg, s, N, V, A, T);
UI values are converted at the edge. Where a value is an **estimate**, the UI
labels it `EST`; user overrides are labelled `USER`. Nothing is presented as a
measured quantity.

---

## 1. Coordinate conventions and constants

- Cone displacement `x` is **positive forward** (out of the magnet, toward the listener).
- Air: `ρ0 = 1.204 kg/m³`, `c = 343 m/s` (20 °C, 1 atm). `μ0 = 4π×10⁻⁷ H/m`.
- Constants live in `src/physics/units.ts`.

## 2. Voice-coil winding model (`winding.ts`)

Given wire bare diameter `d_w`, insulation build factor `k_ins = 1.08`
(single-build allowance, documented assumption), turns per layer `N_l`, layers
`L`, mean first-layer winding diameter `D_0`:

- Pitch: `p = k_ins·d_w`
- Winding height: `h_w = N_l·p` (or user override)
- Layer centre diameters: `D_k = D_0 + 2·k·p·0.5·2` (centres one wire diameter apart radially)
- Wire length: `ℓ = Σ_k π·D_k·N_l`
- Conductor area: `A = π·d_w²/4`
- DC resistance: `Re20 = ρ·ℓ/A`, temperature-corrected:
  `Re(T) = Re20·(1 + α(T − 20))` with copper `α = 0.00393 /K`,
  aluminium `α = 0.00403 /K`.
- Wire mass: `ρ_material·A·ℓ`. Former mass: `π·(D_f + t_f)·h_f·t_f·ρ_former`.

*Limitations:* ignores lead length, non-ideal packing and bond layers. These are
lumped — the UI marks `Re` as an estimate; the user can override it.

## 3. Magnetic circuit (`magnet.ts`)

1-D reluctance model of a permanent-magnet motor:

```
B_gap = Br·A_m / (σ·A_g + μr·A_m·l_g/l_m)        (capped at 1.6 T)
```

where `A_m` = magnet ring cross-section, `A_g = π·D_pole·h_gap` = gap pole
surface, `l_g` = radial gap width, `l_m` = total magnet stack length, `σ` =
leakage factor (user-adjustable, default 2.2 — real ferrite structures leak
heavily; typical range 1.8–2.8), `μr` = recoil permeability, `Br` = remanence
(ferrite Y30 ≈ 0.40 T, N42 ≈ 1.32 T, N52 ≈ 1.43 T).

The 1.6 T cap models saturation of the pole steel, which physically limits gap
flux regardless of magnet strength.

Force factor and turns in the gap:

- Overhung: `N_gap = L·min(N_l, floor(h_gap/p))`
- Underhung: `N_gap = L·N_l` (all winding in the gap)
- `Bl = B_gap · π·D_mean_coil·N_gap`

*Limitations:* no FEM; fringing and leakage are lumped into σ. The saturation
check compares pole flux density against ~1.6 T and warns.

## 4. Moving mass (`tsp.ts`)

```
Mms = m_cone + m_dustcap + m_coil + m_surround/2 + m_spider/3 + m_air
m_air = (8/3)·ρ0·a³            (one-side baffled-piston radiation mass, low-freq)
```

Cone/dust-cap masses come from geometry × material density (user-overridable);
the `½`/`⅓` suspension-mass rules are standard textbook practice.

## 5. Suspension and Thiele–Small parameters

- Total suspension stiffness: `Kms = K_spider + K_surround` (both deflect with the cone),
  `Cms = 1/Kms`.
- Mechanical resistance: `Rms = damping_surround + damping_spider + 2π·Fs·Mms/Qms_target`
  (default `Qms_target = 5.2`) or a direct user override.
- `Fs = 1/(2π·√(Mms·Cms))`
- `Qms = 2π·Fs·Mms/Rms`
- `Qes = 2π·Fs·Mms·Re/Bl²`  (inductance ignored, per the standard definition)
- `Qts = Qms·Qes/(Qms + Qes)`
- `Vas = ρ0·c²·Sd²·Cms`
- Reference efficiency: `η0 = ρ0·Bl²·Sd² / (2π·c·Re·Mms²)`
- Sensitivity (mass-controlled region, half-space): `SPL ≈ 112.02 + 10·log10(η0)` dB @ 1 W / 1 m.

**Excursion limits** (deliberately distinct, never conflated in the UI):

- `Xmax` (one-way linear):
  overhung `Xmax = (h_coil − h_gap)/2`; underhung `Xmax = (h_gap − h_coil)/2`.
- `Xmech` (one-way mechanical travel): default `2.5·Xmax`, user-settable.
- Peak-to-peak travel = `2·Xmax`; total mechanical clearance = `2·Xmech`.

## 6. State-space model (`stateSpace.ts`)

The linear engine (one model for free-air / sealed / ported / PR) uses states
`[i, x_d, v_d, x_p, v_p]` (port states only when a port/PR is present):

```
Le·di/dt        = u_kw − (Re+Rs)·i − Bl·v_d          (back-EMF + inductance)
dx_d/dt         = v_d
Mms·dv_d/dt     = Bl·i − Rms·v_d − (Kms+Kb)·x_d + Kcp·x_p
dx_p/dt         = v_p
M_p·dv_p/dt     = Kcp·x_d − Kpp·x_p − Rp·v_p          (port air mass)
   (PR replaces the last row with its mass/spring/damper)
```

Box coupling (adiabatic gas law, referred to the cone):

```
p = (ρ0·c²/Vb)·(Sd·x_d − Sp·x_p)
Kb  = ρ0·c²·Sd²/Vb        Kcp = ρ0·c²·Sd·Sp/Vb        Kpp = ρ0·c²·Sp²/Vb
```

Damping fill converts the box to an effective (acoustically larger) volume via
factors: none 1.00, light 1.05, lined 1.10, heavy 1.16 (illustrative).

Multiple drivers: each identical driver is simulated per-driver with input
voltage factor `k_w` (parallel 1, series 1/n); total pressure scales by
`n·k_w` (coherent far-field sum). Dual voice coils: parallel → `Re/2, Le/2`;
series → `Bl·2` (same current through both gaps).

Output rows: displacement, velocity, current, and far-field pressure
`p(1 m) = (ρ0/2π)·(Sd·a_d + Sp·a_p)` (piston, on-axis, infinite baffle).

## 7. Discretization and real-time simulation

- ZOH discretization via the block matrix exponential
  `exp([[A,B],[0,0]]·dt) = [[Ad,Bd],[0,I]]`, computed by scaling-and-squaring
  with a Taylor series (`linalg.expm`). This is exact for piecewise-constant
  input (audio samples) and unconditionally stable *for the discrete system*.
- The engine discretizes **at the AudioContext's actual hardware rate**
  (44.1 k / 48 k / 96 k) — not an assumed rate.
- `public/speaker-worklet.js` advances `state' = Ad·state + Bd·u` per sample,
  with input sanitization, a non-finite self-heal, a hard mechanical stop at
  ±Xmech (velocity-reflection model, restitution −0.06), optional voltage
  clipping and current-limit reporting.
- Nonlinear "Advanced" mode: semi-implicit (symplectic) Euler with substeps:
  `Bl(x) = Bl0·max(0.05, 1 − k_bl·(x/Xmech)²)`,
  `Kms(x) = Kms0·(1 + k_kms·(x/Xmax)²)`. Documented approximation.

## 8. Frequency-domain evaluation (`freqresp.ts`)

- Any output row: `H(jω) = C·(jωI − A)⁻¹·B` via complex Gaussian elimination —
  exact for the linear model.
- Electrical impedance (analytic, per topology):
  `Z = Re + Rs + jωLe + Bl²/Z_mech(jω)`, where for ported systems the
  mechanical impedance solves the 2-DOF cone/port system
  `[Zd −Zcp; −Zcp Zp2]·[v_d; v_p] = [F; 0]`, `v_d/F = Zp2/det`.
- Port tuning: `Fb = (c/2π)·√(Sp/(Vb·L_eff))` with end correction
  `L_eff = L + 2·k_end·r` (flared `k_end = 0.85`, plain `0.732`).
- PR tuning: PR mass against the series combination of box compliance (referred
  to PR area) and the PR's own suspension compliance.
- Port air speed warning at ~17 m/s (audible noise) and ~27 m/s (chuffing).
- Net volume subtracts driver displacement (motor + basket estimate), port
  volume, PR displacement and bracing from the gross internal volume.
- SPL plots are far-field piston predictions — no baffle-step loss, cone
  breakup, or room effects. They are **not** microphone measurements.

## 9. Amplifier model (`amplifier.ts`)

- Voltage source with optional output impedance `Rs` (added to the electrical
  branch), bridging (×2 swing), drive by RMS voltage or power
  (`V = √(P·Z_load)` using the **actual** load — power is never assumed fixed).
- Clipping: hard clamp at ±V_clip·√2. Current limit: detected and reported
  (folded at the limit value). RMS vs peak vs peak-to-peak quantities are
  labelled distinctly in the UI.

## 10. Synchronization (`audio/sync.ts`)

- The worklet posts `{x, v, i, t}` stamped with `AudioContext.currentTime`.
- `SyncClock.offset()` reconstructs playback position across play/pause/seek
  with rate support (slow motion).
- `renderDisplacement()` extrapolates `x + v·dt` from the newest sample to the
  current audio clock (dt capped at 50 ms) — smooth at display rates and
  inherently synced to what you hear. A health flag (`SYNC LOCKED / STALE`) and
  a manual "Reset simulation" recalibrate the filter.

## 11. Verification

`src/tests/physics.test.ts` validates:

1. Fs, Qms/Qes/Qts, Vas against the analytical equations (≤ 1e-12 relative).
2. Impedance peak at free-air Fs, purely resistive there, height `Re + Bl²/Rms`.
3. Sealed box raises the impedance peak to `Fc = Fs·√(1+Vas/Vb_eff)` (≤ 3 %).
4. ZOH time-domain response matches `H(jω)` at spot frequencies (≤ 3 %).
5. Positive/negative DC → signed displacement; DC value `Bl·u/(Re·Kms)`.
6. Linear scaling `x(2u) = 2·x(u)`; zero input → zero state.
7. Unit conversions; hand-computed winding resistance (length, Re, temperature).
8. Enclosure volumes (gross/net with port & bracing subtraction) and Helmholtz Fb.
9. Series/parallel impedance algebra; amplifier power `P = V²/Z` behaviour.
10. Sync clock across play/pause/seek + render extrapolation + health.
11. Project serialization round-trip; partial-file repair; foreign-file rejection.
12. Stability: randomized plausible drivers/boxes driven by sweeps and bursts
    stay bounded; impulse responses decay.

## 12. Known limitations

- Linear small-signal core; nonlinear mode covers BL droop and suspension
  stiffening only (no inductance modulation `Le(x,i)`, no eddy-current hysteresis).
- SPL is a rigid-piston, infinite-baffle estimate; no baffle step, edge
  diffraction, breakup modes or thermal compression.
- The 3D model is parametric-revolution geometry: realistic, but not a CAD
  surrogate (no true spiralled wire, no lead-cloth dynamics).
- Material values are typical literature figures (`illustrative: true`) — not
  verified per commercial grade.
- Impedance above ~2 kHz is dominated by `Le` modeled as a constant (no
  semi-inductance lossy models).
