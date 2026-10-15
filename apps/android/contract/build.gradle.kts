plugins {
    kotlin("jvm")
}

dependencies {
    implementation("com.networknt:json-schema-validator:1.5.6")
    // JsonElement tree parsing only — the parser carries no serialization
    // annotations, so the runtime jar needs no compiler plugin.
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")
    testImplementation(kotlin("test"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}

// Copy the authoritative schema straight from the protocol package so the
// Kotlin column always validates the current candidate bytes, never a fork.
val copyContractSchema by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/typert/protocol/remote-errors.schema.json"))
    into(layout.buildDirectory.dir("contract-schema"))
}

// Copy the generated tool-descriptor projection straight from the core tools
// package; until that generator lands the projection test skips on absence.
val copyToolDescriptors by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/core/tools/tool-descriptors.json"))
    into(layout.buildDirectory.dir("tool-descriptors"))
}

// Copy the generated lite-preset projection straight from the preset package;
// until that generator lands the cross-check skips on absence.
val copyLitePresets by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/preset/agent-presets/lite-preset-descriptors.json"))
    into(layout.buildDirectory.dir("lite-presets"))
}

// Copy the generated lite tool-schema projection straight from the core tools
// package; until that generator lands the mirror skips on absence.
val copyLiteToolSchemas by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/core/tools/lite-tool-schemas.json"))
    into(layout.buildDirectory.dir("lite-tool-schemas"))
}

sourceSets.test {
    resources.srcDir(copyContractSchema)
    resources.srcDir(copyToolDescriptors)
    resources.srcDir(copyLitePresets)
    resources.srcDir(copyLiteToolSchemas)
}
