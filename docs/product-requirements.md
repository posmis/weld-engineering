# WELD ENGINEERING — ENGINEERING WELD DESIGN AND CALCULATION SOFTWARE

## 1. Role and overall objective

You are a senior Rust software engineer, mechanical design engineer, welding engineer, numerical methods specialist, and desktop application architect.

Develop a production-oriented engineering desktop application named **Weld Engineering**.

The software must help mechanical engineers select, design, calculate, verify, compare, and document welded joints according to applicable engineering standards.

This is not a construction-oriented structural steel design application. Its primary field is **mechanical engineering and machinery design**.

Typical applications include:

- Welded machine frames.
- Sheet-metal brackets.
- Equipment housings.
- Supports and mounting structures.
- Welded mechanical assemblies.
- Robotic equipment and mobile machinery.
- Load-bearing mechanical components.
- Welded joints subjected to forces, moments, vibrations, and dynamic loading.

The application must be a real engineering calculation tool, not a demonstration, decorative interface, or collection of approximate calculators.

Implement a functioning application with a modular architecture, automated testing, documentation, and an extensible calculation engine.

**Important:** Never invent standard clauses, material properties, allowable stresses, formulas, or coefficients. Every normative calculation must be traceable to a verified source.

---

# 2. Technology stack

Use the following preferred stack:

| Component | Technology |
|---|---|
| Engineering calculation core | Rust |
| Desktop framework | Tauri 2 |
| Frontend | TypeScript |
| Frontend framework | React |
| Styling | CSS |
| Local database | SQLite |
| Numerical computation | Rust |
| Data serialization | Serde / JSON |
| API | REST / OpenAPI |
| Testing | Rust unit/integration tests, frontend tests |
| Platform | Windows 10/11 x64 |
| Documentation | Markdown |
| PDF reports | Suitable Rust or frontend PDF generation library |

You may propose a technically superior alternative for an individual component, but justify the change before implementation.

The engineering calculation core must be implemented in Rust.

Do not implement critical engineering calculations in JavaScript.

The application must initially target Windows.

However, its architecture must permit future support for macOS and Linux without rewriting the engineering core.

Do not implement or test other operating systems during the initial development.

---

# 3. Fundamental architectural requirements

Separate the application into independent modules.

Recommended workspace:

```text
weld-engineering/
├── apps/
│   └── desktop/
│       ├── src/
│       └── src-tauri/
├── crates/
│   ├── weld-core/
│   ├── weld-geometry/
│   ├── weld-mechanics/
│   ├── weld-standards/
│   ├── weld-materials/
│   ├── weld-optimization/
│   ├── weld-quality/
│   ├── weld-fatigue/
│   ├── weld-pressure/
│   ├── weld-reporting/
│   └── weld-api/
├── data/
│   ├── standards/
│   ├── materials/
│   └── examples/
├── tests/
├── docs/
└── Cargo.toml
```

The calculation engine must:

- Operate independently of the graphical interface.
- Have a stable, documented public Rust API.
- Use explicit physical units.
- Support serialization of calculation inputs and results.
- Return structured calculation errors.
- Support different engineering calculation methodologies.
- Support versioned standards and material datasets.
- Permit future integration with CAD applications.

Do not couple numerical calculations to Tauri commands.

The GUI must call the calculation engine through a defined application service layer.

---

# 4. Engineering standards and regulatory research

Mandatory requirement: Current and valid standards only

The application must use exclusively the latest officially effective editions of applicable GOST, GOST R, GOST EN, GOST ISO, and other engineering standards.

Before implementing or importing any standard, verify its current legal and technical status using official standards registries.

Requirements:

Never use withdrawn, superseded, cancelled, or expired standards.

Automatically identify the latest effective replacement when a standard has been superseded.

Include all currently effective amendments and corrections.

Verify applicability to mechanical engineering, materials, welding processes, and the relevant jurisdiction.

Do not assume that the standard with the highest year number is already effective.

Do not import obsolete normative tables or calculation coefficients.

Do not provide historical standard selection in the GUI.

Do not use obsolete editions as fallback calculation methods.

When a standard is replaced, update the normative database and mark the affected calculation methods for revalidation.

Previously saved calculation projects must preserve their original inputs and results for reproducibility, but any new or repeated normative calculation must use the current effective standards.

If a standard's status cannot be verified, exclude it from normative calculations until verification is completed.

Example: Use GOST EN 1011-6-2025, including its effective correction, instead of the superseded GOST EN 1011-6-2017.

Apply this policy to the entire standards database, including the complete GOST EN 1011 series and all related welding, strength, material, and quality standards.

## 4.1. Weld geometry standards

Research and support, where applicable:

- GOST 5264-80 — Manual arc welding. Welded joints.
- GOST 14771-76 — Arc welding in shielding gases. Welded joints.
- GOST 8713-79 — Submerged arc welding. Welded joints.
- GOST 16037-80 — Welded joints of steel pipelines.
- Other applicable GOST standards for welded joint geometry and welding processes.

Verify current validity, amendments, scope, materials, and limitations for every standard.

Support the following joint families:

- Butt joints: C1, C2, etc.
- Tee joints: T1, T2, T3, etc.
- Corner joints: U1, U2, etc.
- Lap joints: H1, H2, etc.
- Applicable pipe joints.
- Other standardized joint types supported by verified source data.

Use the actual Cyrillic designations internally or store a normalized identifier together with the original standard designation.

Do not assume that the same joint designation has identical geometry in different standards.

For each supported joint type, store:

- Standard number and edition.
- Joint designation.
- Welding process.
- Joint configuration.
- Applicable material families.
- Thickness range.
- Edge preparation geometry.
- Root gap.
- Bevel angle.
- Root face.
- Weld dimensions.
- Permissible dimensional ranges.
- Relevant restrictions.
- Original table and clause references.

Use source-verified tabular data.

Do not reconstruct missing standard tables from memory.

## 4.2. GOST EN 1011 standards family

Conduct a comprehensive investigation of the GOST EN 1011-* series and its relationship to the corresponding EN 1011 documents.

Investigate the available parts, including:

- Part 1 — General guidance for arc welding.
- Part 2 — Arc welding of ferritic steels.
- Part 3 — Arc welding of stainless steels.
- Part 4 — Arc welding of aluminium and aluminium alloys.
- Part 5 — Welding of clad steel.
- Part 6 — Laser beam welding.
- Part 7 — Electron beam welding.
- Part 8 — Welding of cast irons.

For every part, verify whether a corresponding GOST adoption exists, its exact designation, edition, status, and scope.

Do not assume that every EN 1011 part has an equivalent current GOST.

Study the provisions relevant to:

- Material weldability.
- Joint preparation.
- Welding process selection.
- Welding consumables.
- Preheating.
- Heat input.
- Cooling conditions.
- Cracking risks.
- Welding sequence.
- Residual stresses.
- Distortion.
- Post-weld heat treatment.
- Weld imperfections.
- Inspection.
- Production quality requirements.

Separate mandatory requirements, recommendations, informative guidance, and requirements referenced from other documents.

Do not interpret welding procedure recommendations as numerical strength acceptance criteria unless the relevant normative basis explicitly supports that interpretation.

## 4.3. Mandatory laser welding support

Laser welding is a required welding process.

Research both:

- GOST EN 1011-6-2017 — historical edition.
- GOST EN 1011-6-2025 — current replacement edition, effective from 2026-01-01.

Verify amendments and corrections.

Support edition selection in the standards database.

Laser welding must be treated as a distinct welding process, not simply as arc welding with a different process label.

The laser welding module must model, where supported by verified sources:

- Weld penetration depth.
- Effective fusion dimensions.
- Joint fit-up and gap requirements.
- Beam accessibility.
- Material thickness.
- Welding configuration.
- Full and partial penetration.
- Applicable weld imperfections.
- Process-related quality constraints.
- Applicable inspection and qualification requirements.

Research referenced standards relevant to laser weld quality, imperfection acceptance, procedure specifications, and procedure qualification.

Do not apply a conventional fillet-weld throat or leg-size calculation to a laser weld unless the actual joint geometry and selected verified calculation methodology justify it.

Do not automatically equate penetration depth with effective load-bearing thickness.

If a reliable strength calculation methodology is unavailable, the application must provide geometry and process recommendations while clearly identifying the strength calculation as unsupported.

## 4.4. Mechanical engineering strength calculation methodology

Find and evaluate authoritative methodologies for calculating welded joints in mechanical engineering.

The research must distinguish between:

- Mechanical engineering design methods.
- Structural steel building design methods.
- Pressure equipment methods.
- Fatigue assessment methods.
- Experimental qualification and test-based acceptance.

Building design standards must not be silently applied to machinery.

If a method originates from building construction, label its origin and scope and require explicit confirmation before using it outside its verified applicability.

Identify appropriate normative or scientifically justified calculation methods for:

- Static loading.
- Combined loading.
- Eccentrically loaded weld groups.
- Fatigue loading.
- Welded joints with full or partial penetration.
- Local failure of the base material.
- Pressure-loaded welded assemblies.

For each method, document:

- Original source.
- Edition.
- Applicable joint types.
- Applicable materials.
- Assumptions.
- Calculation formulas.
- Safety or partial factors.
- Limitations.
- Validation examples.

If a verified method cannot be identified, mark the feature as requiring further research instead of inventing a formula.

---

# 5. Engineering calculation engine

## 5.1. Input geometry

The user must be able to specify:

- Thickness of each welded part.
- Material of each part.
- Joint type.
- Welding process.
- Weld position and orientation.
- Weld length.
- Weld leg size, if applicable.
- Effective throat, if applicable.
- Penetration depth, if applicable.
- Root gap.
- Edge preparation.
- Number of welds.
- Relative position of welds.
- Weld continuity.
- Welding from one or both sides.

Validate every input against the selected standard and calculation method.

## 5.2. Coordinate system and loading

Implement a consistent three-dimensional coordinate system.

Support force and moment vectors:

F = (Fx, Fy, Fz)

M = (Mx, My, Mz)

The user must be able to enter:

- Individual force components.
- Force magnitude and direction.
- Load application point.
- Moments.
- Mass and acceleration.
- Dynamic amplification factors.
- Internal pressure.
- External pressure.
- Multiple load cases.

Convert force application points into the appropriate moments about the calculation reference point.

Provide clear sign conventions and coordinate system documentation.

Use dimensional analysis to prevent incorrect unit combinations.

## 5.3. Weld groups

Support:

- Single straight welds.
- Parallel welds.
- Perpendicular welds.
- Multiple weld segments.
- Arbitrary planar weld groups.
- Closed weld contours.
- Intermittent welds.
- Symmetrical and asymmetrical weld layouts.

The geometry engine must calculate, where applicable:

- Total weld length.
- Effective weld length.
- Weld group centroid.
- Effective cross-sectional area.
- Relevant second moments of area.
- Product of inertia.
- Polar second moment.
- Local weld orientation.
- Stress distribution.
- Critical weld locations.

For arbitrary spatial weld groups, do not assume that planar weld-group formulas remain valid.

If a selected methodology only supports planar weld groups, enforce that restriction.

## 5.4. Strength calculation

Implement verified engineering calculation methods for:

- Tension.
- Compression.
- Shear.
- Bending.
- Torsion.
- Combined loading.
- Eccentric loading.
- Loads at arbitrary angles.

The application must distinguish between stresses in:

- Weld metal.
- Effective weld throat or fusion section.
- Heat-affected zone, when the selected methodology supports it.
- Adjacent base material.

Calculate utilization factors and safety margins.

Do not use one universal equivalent-stress formula for every weld type.

Each calculation must use a documented failure criterion applicable to the selected material, joint, and loading condition.

## 5.5. Weld size selection

Implement automatic selection of weld dimensions.

For conventional fillet welds, calculate or select:

- Minimum permissible leg size.
- Maximum permissible leg size.
- Required effective throat.
- Required weld length.
- Geometric restrictions.
- Strength utilization.

Determine whether the limiting factor is:

- Weld strength.
- Base material strength.
- Standard geometry limits.
- Minimum technological dimensions.
- Available weld length.
- Other applicable constraints.

The smallest geometrically permissible weld is not necessarily sufficient for strength.

The largest geometrically permissible weld is not necessarily technically or economically optimal.

For butt welds and laser welds, use their actual relevant dimensions rather than forcing every calculation into a fillet leg-size model.

---

# 6. Automatic weld selection

Implement two operating modes.

## Manual mode

The user selects:

- Welding process.
- Standard.
- Joint designation.
- Weld dimensions.
- Loading conditions.

The application validates the configuration and calculates the result.

## Automatic mode

The user specifies:

- Part materials.
- Thicknesses.
- General joint configuration.
- Loading.
- Service conditions.
- Manufacturing restrictions.
- Available welding processes.

The application must:

1. Identify applicable standards.
2. Generate technically valid candidate joints.
3. Determine permissible dimensions.
4. Calculate strength.
5. Check additional constraints.
6. Reject unsuitable alternatives.
7. Optimize the remaining candidates.
8. Present multiple feasible solutions.

Do not silently substitute an unverified joint type.

Every candidate must include an explanation of why it is applicable or rejected.

---

# 7. Multi-objective optimization

Support multiple optimization objectives:

- Minimum weld leg size.
- Minimum weld length.
- Minimum deposited weld metal mass.
- Minimum estimated manufacturing cost.
- Maximum strength margin.
- Comparison of multiple solutions.

Use constrained optimization.

A candidate is feasible only if it satisfies every mandatory applicable constraint.

Do not trade away safety requirements in exchange for lower cost or mass.

Support Pareto comparison where appropriate.

Cost calculations must use configurable production parameters such as:

- Welding process.
- Deposition efficiency.
- Welding speed.
- Preparation time.
- Labor rate.
- Consumable cost.
- Equipment cost model.
- Number of passes.
- Inspection cost, when applicable.

Do not present estimated cost as an actual quotation.

Show the assumptions behind every cost estimate.

---

# 8. Material database

Create an extensible material database.

Support:

- Carbon structural steels.
- Low-alloy steels.
- Stainless steels.
- Aluminium alloys.
- User-defined materials.

Each material record may include:

- Material designation.
- Applicable material standard.
- Product form.
- Delivery condition.
- Heat treatment condition.
- Thickness-dependent properties.
- Temperature-dependent properties.
- Yield strength.
- Ultimate tensile strength.
- Elastic modulus.
- Poisson ratio.
- Shear modulus.
- Elongation.
- Density.
- Weldability information.
- Relevant welding restrictions.
- Source references.

Do not invent missing material properties.

Store unknown properties explicitly as unknown.

Do not infer welded-joint strength directly from base-metal ultimate tensile strength without a justified method.

Allow separate specification of base material and weld metal.

Support heterogeneous joints only where a verified methodology exists.

---

# 9. Safety factors and service conditions

Implement configurable engineering safety factors.

The software should propose factors based on the selected methodology and operating conditions when a verified source exists.

Allow users to override factors.

Every override must be recorded.

Distinguish:

- Normative factors.
- User-selected design factors.
- Dynamic amplification factors.
- Material-related factors.
- Weld-related factors.
- Fatigue-related factors.

Do not multiply overlapping factors without checking the methodology.

Display the complete factor chain in the calculation report.

---

# 10. Fatigue analysis

Create an independent fatigue analysis module.

It must eventually support:

- Repeated loading.
- Load cycles.
- Stress ranges.
- Mean stress, where applicable.
- Weld detail classification.
- Fatigue resistance.
- Cumulative damage.
- Variable-amplitude loading.
- Fatigue utilization.

Use verified fatigue methodologies.

Do not apply base-metal fatigue curves to welded joints without justification.

Clearly identify when fatigue data or load spectra are insufficient.

Do not implement a decorative fatigue indicator.

The initial release may expose this module as unavailable until its numerical methods are verified.

---

# 11. Pressure and leak-tightness

Create an independent pressure and leak-tightness module.

Support future calculations involving:

- Internal pressure.
- External pressure.
- Pressure-loaded welded housings.
- Pipe joints.
- Welded tanks and containers.
- Applicable pressure-induced forces.

Separate three concepts:

1. Structural strength under pressure.
2. Resistance to pressure-induced deformation or failure.
3. Leak-tightness and acceptance testing.

A satisfactory static strength calculation must never be treated as proof of leak-tightness.

Do not calculate leak-tightness solely from weld leg size.

Where applicable, recommend required verification methods based on validated standards and user-defined acceptance requirements.

Do not claim that a welded component is pressure-equipment compliant without verifying the complete applicable requirements.

---

# 12. Weld quality and manufacturing requirements

Implement a weld quality and manufacturing assessment subsystem.

Research applicable standards for:

- Weld imperfections.
- Acceptance levels.
- Inspection methods.
- Welding procedure specifications.
- Welding procedure qualification.
- Personnel qualification.
- Material preparation.
- Preheating.
- Post-weld heat treatment.
- Distortion control.
- Laser welding quality requirements.

The application must distinguish:

- Calculated strength.
- Technological feasibility.
- Predicted manufacturing risks.
- Inspection requirements.
- Verified production quality.

A calculated weld cannot be automatically considered defect-free.

Display quality-related warnings and required verification steps.

---

# 13. Graphical user interface

Build a professional engineering desktop interface.

Visual design requirements:

- Clean, technical appearance.
- High information density.
- Minimal decorative elements.
- Rectangular controls.
- Consistent typography.
- Clear numerical input fields.
- Engineering units displayed beside values.
- Light and dark themes.
- Russian and English localization architecture.

The initial interface language must be Russian.

English localization must be supported by the architecture and translation files.

Avoid excessive animations and decorative dashboards.

## 13.1. Main workspace

Organize the workspace into:

- Joint configuration.
- Materials.
- Weld geometry.
- Loading.
- Calculation settings.
- Results.
- Candidate comparison.
- Reports.
- Standards and references.

## 13.2. Interactive 2D geometry

Implement an interactive 2D drawing of the selected joint.

Show:

- Welded components.
- Thicknesses.
- Weld cross-section.
- Joint preparation.
- Weld dimensions.
- Root gap.
- Bevel angle.
- Relevant geometric labels.

Dimensions must be generated from the actual engineering geometry model.

Do not use static illustrations that disagree with user input.

## 13.3. Interactive weld layout

Implement a separate 2D workspace for weld groups.

The user must be able to:

- Create weld segments.
- Move segment endpoints.
- Set lengths.
- Define coordinates.
- Create closed contours.
- Configure intermittent welds.
- Specify force application points.
- Display load vectors.
- Display moments.
- Display the weld group centroid.
- Highlight critical regions.

Provide numerical editing as an alternative to mouse interaction.

## 13.4. Results

Display:

- Selected standard.
- Joint designation.
- Weld dimensions.
- Calculated stresses.
- Allowable or design resistances.
- Utilization factors.
- Safety margins.
- Governing failure mode.
- Warnings.
- Calculation validity status.

Use clearly distinguishable result states:

- Verified pass.
- Verified fail.
- Insufficient data.
- Unsupported calculation.
- Not yet validated.

Never display an unsupported calculation as a successful result.

---

# 14. Calculation reports

Generate professional PDF engineering reports.

Each report must contain:

- Project identification.
- Calculation date.
- Software version.
- Calculation engine version.
- Standard versions.
- Selected calculation methodology.
- Materials.
- Joint configuration.
- Weld dimensions.
- Loading.
- Coordinate systems.
- Input assumptions.
- Calculation formulas.
- Substituted numerical values.
- Intermediate results.
- Final results.
- Utilization factors.
- Critical weld locations.
- Warnings.
- Source references.
- Calculation validity status.

Include diagrams of the joint and load configuration.

Every normative formula must reference its verified source and exact clause, table, or equation where available.

Clearly distinguish normative formulas from independently derived mechanical formulas.

If a result relies on user-defined assumptions, display them prominently.

Support saving and reopening calculation projects.

Use a versioned project data format.

---

# 15. REST API and future CAD integration

Design the calculation core for use by external applications.

Provide a REST API with a documented OpenAPI specification.

The API must eventually support:

- Listing available standards.
- Listing joint types.
- Retrieving material properties.
- Validating joint geometry.
- Performing calculations.
- Running automatic selection.
- Comparing candidate solutions.
- Generating reports.

Use versioned endpoints.

Example conceptual endpoints:

```http
GET  /api/v1/standards
GET  /api/v1/materials
GET  /api/v1/joints
POST /api/v1/joints/validate
POST /api/v1/calculate
POST /api/v1/optimize
POST /api/v1/reports
```

The initial implementation may run the API locally.

Do not expose the service publicly by default.

Use appropriate input validation, resource limits, and error handling.

## Autodesk Inventor compatibility

Future integration with Autodesk Inventor is required architecturally.

Do not implement the Inventor add-in now.

Instead:

- Design stable calculation request and response schemas.
- Support geometry descriptions independent of CAD software.
- Define coordinate transformation conventions.
- Support physical units explicitly.
- Document how an Inventor add-in could extract weld geometry.
- Document how an Inventor add-in could submit calculations.
- Document how calculated results could be returned to Inventor.

Prepare detailed integration documentation for future C# Inventor API development.

The future CAD adapter must remain separate from the calculation engine.

---

# 16. Standards database and traceability

Create a structured, versioned standards database.

Each normative record must include:

```text
standard_id
standard_designation
standard_title
edition
amendment
jurisdiction
effective_date
status
source_url
source_document_reference
clause
table
applicability
engineering_parameter
value
unit
verification_status
```

Use a normalized schema where appropriate.

Do not store unverified engineering values as verified.

Implement a data verification workflow.

Support:

- Updating normative datasets.
- Adding new standard editions.
- Retaining historical editions.
- Comparing changes between editions.
- Adding custom calculation methodologies.
- Tracking the provenance of every engineering parameter.

Custom methodologies must be explicitly identified as custom.

Updating a standard must not silently change the results of previously saved engineering calculations.

Saved projects must retain enough information to reproduce their original results.

---

# 17. Numerical reliability

Numerical correctness is a primary requirement.

Implement:

- Strong input validation.
- Physical unit consistency.
- Finite-value checks.
- Singular geometry detection.
- Zero-length weld detection.
- Degenerate weld-group detection.
- Load sign convention checks.
- Numerical tolerance management.
- Clear error propagation.
- Deterministic calculation behavior.

Avoid silent clamping of engineering values.

Avoid arbitrary constants without documented justification.

Use double-precision floating-point arithmetic where appropriate.

For every numerical method, document assumptions and limitations.

---

# 18. Verification and automated testing

Implement a comprehensive test suite.

## Unit tests

Test:

- Unit conversion.
- Geometric properties.
- Weld lengths.
- Effective areas.
- Centroids.
- Moments of inertia.
- Force transformations.
- Moment transformations.
- Material property lookup.
- Standards applicability.
- Safety factor handling.

## Engineering verification tests

Use independently verified engineering examples.

Compare software results against:

- Authoritative calculation examples.
- Published engineering references.
- Analytical solutions.
- Independently calculated benchmark cases.

Do not use the application's own results as its only verification reference.

## Invariant and property tests

Test physically meaningful properties.

Examples:

- Zero applied load produces zero load-induced stress.
- Reversing the sign of a linear elastic load reverses the corresponding signed stress components.
- Translating the coordinate system does not change physical results when force application points and moments are transformed consistently.
- Rotating the entire model and its load vectors consistently preserves invariant strength measures for an isotropic, direction-independent model.
- Increasing effective weld area must not increase nominal direct stress under otherwise identical conditions.
- Invalid or degenerate geometry must not produce a successful calculation.

These properties must be restricted to methods for which their assumptions hold.

## Regression tests

Every corrected numerical defect must receive a regression test.

## Integration tests

Verify:

- Core-to-GUI communication.
- API request validation.
- Database access.
- Project serialization.
- Report generation.
- Standard edition selection.

---

# 19. Development phases

Implement the project incrementally.

## Phase 0 — Engineering research and architecture

Deliver:

- Standards research report.
- Verified standards registry.
- Calculation methodology comparison.
- Source and clause traceability plan.
- Risk assessment.
- Architecture specification.
- Data model.
- Implementation roadmap.

Identify all formulas requiring additional verification.

Do not implement unverified normative formulas.

## Phase 1 — Functional MVP

Implement:

- Rust calculation core.
- Windows desktop application.
- Material database foundation.
- Standards database foundation.
- Basic joint selection.
- Butt, tee, corner, and lap joint geometry where verified.
- Single straight weld calculation.
- Basic planar weld group calculation.
- Verified static strength methods.
- Manual weld size selection.
- Automatic fillet weld size selection.
- Basic 2D diagrams.
- Calculation results.
- PDF reports.
- Unit and verification tests.

The MVP must be usable for real calculations within its explicitly validated scope.

Do not label incomplete methods as complete.

## Phase 2 — Advanced mechanics

Implement:

- Arbitrary planar weld groups.
- Multiple load cases.
- Combined loading.
- Eccentric loading.
- Bending and torsion.
- Intermittent welds.
- Optimization and candidate comparison.
- More extensive material data.

## Phase 3 — Manufacturing and quality

Implement:

- Extended GOST EN 1011 support.
- Welding process recommendations.
- Manufacturing restrictions.
- Quality-related checks.
- Weld imperfections and inspection requirements.
- Verified laser welding geometry and applicability.
- Additional welding processes.

## Phase 4 — Specialized engineering

Implement:

- Fatigue analysis.
- Pressure loading.
- Leak-tightness requirements.
- Additional verified mechanical engineering methods.
- Advanced optimization.
- Expanded reports.

## Phase 5 — Integration readiness

Implement:

- Documented REST API.
- OpenAPI schemas.
- Integration examples.
- Autodesk Inventor integration guide.
- External application examples.
- Version compatibility policy.

---

# 20. Documentation requirements

Create detailed documentation.

Required documents:

```text
docs/
├── architecture.md
├── getting-started.md
├── engineering-methods.md
├── standards-research.md
├── standards-traceability.md
├── material-database.md
├── numerical-verification.md
├── api-reference.md
├── inventor-integration.md
├── testing.md
├── limitations.md
└── roadmap.md
```

The engineering documentation must explain formulas and assumptions in sufficient detail for independent review.

The API documentation must include complete request and response examples.

The Inventor integration documentation must explain the future integration architecture without requiring Inventor to be installed.

---

# 21. Explicit restrictions

Do not:

- Generate a decorative prototype instead of a functional application.
- Fabricate GOST tables.
- Invent material strength properties.
- Invent normative coefficients.
- Invent standard clauses.
- Apply building design rules automatically to machinery.
- Treat weld appearance as proof of weld quality.
- Treat static strength as proof of leak-tightness.
- Treat every weld as a fillet weld.
- Use arbitrary effective throat assumptions for laser welds.
- Return success when critical data is missing.
- Hide calculation limitations.
- Implement critical calculations exclusively in frontend code.
- Mix engineering calculations with graphical interface logic.
- Skip numerical verification.
- Claim compliance with standards without sufficient evidence.

If a calculation cannot be implemented reliably, preserve the architecture and return a clearly structured unsupported-method result.

Never replace an unavailable engineering method with a plausible-looking approximation without explicit identification and user approval.

---

# 22. Engineering acceptance criteria

A calculation module is considered complete only when:

1. Its engineering scope is documented.
2. Its formulas have verified references or independently justified derivations.
3. Its physical units are validated.
4. Its numerical implementation has automated tests.
5. Its results are checked against independent benchmarks.
6. Its limitations are documented.
7. Invalid inputs are handled correctly.
8. Its output can be reproduced.
9. The GUI displays the actual calculation result.
10. The report contains sufficient information for engineering review.

A feature is not complete merely because its interface exists.

---

# 23. Instructions for autonomous development

Work autonomously, but preserve engineering correctness.

Start by inspecting the repository and development environment.

Then perform Phase 0.

Present the proposed architecture, verified normative sources, methodology selection, and implementation risks.

Proceed with implementation using the validated findings.

Create real source files, tests, documentation, and runnable builds.

Execute tests and fix failures.

Do not claim that tests passed unless they were actually executed.

If official standards are inaccessible, record the missing source and request the necessary document rather than inventing its contents.

Maintain a clear distinction between:

- Implemented and verified.
- Implemented but not independently validated.
- Planned.
- Unsupported due to insufficient normative data.

At the end of each phase, provide:

- Implemented functionality.
- Engineering methods used.
- Sources verified.
- Tests executed.
- Known limitations.
- Next development tasks.

**Final objective:** Deliver a reliable, extensible engineering software system capable of selecting and calculating welded joints for mechanical engineering applications, with transparent calculations, traceable standards, accurate geometry, useful visualization, and future CAD integration capability.