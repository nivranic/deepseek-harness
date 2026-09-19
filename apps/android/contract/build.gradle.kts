plugins {
    kotlin("jvm")
}

dependencies {
    implementation("com.networknt:json-schema-validator:1.5.6")
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

sourceSets.test {
    resources.srcDir(copyContractSchema)
}
