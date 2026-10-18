plugins {
    `java-library`
    kotlin("jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // JsonElement tree parsing only — the generated contract models carry no
    // serialization annotations, so the runtime jar needs no compiler plugin.
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    // The Gateway failure envelope and shared failure classification the shell
    // consumes for presentation; api because the presenter's surface exposes
    // RemoteFailureClass.
    api(project(":contract"))
    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("app.cash.turbine:turbine:1.2.0")
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showExceptions = true
        showCauses = true
    }
}

// Copy the generated tool-descriptor projection straight from the core tools
// package so the bundled-set mirror test compares against the current
// candidate bytes; until that generator lands the mirror skips on absence.
// The app-owned device declarations and device schemas ride the same copy:
// the union-consistency twins read those documents off the test classpath.
val copyToolDescriptors by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/core/tools/tool-descriptors.json"))
    from(rootProject.projectDir.parentFile.parentFile.resolve("apps/android/app/lite/lite-tool-declarations.json"))
    from(rootProject.projectDir.parentFile.parentFile.resolve("apps/android/app/lite/lite-device-tool-schemas.json"))
    into(layout.buildDirectory.dir("tool-descriptors"))
}

// Copy the generated lite-preset projection straight from the preset package;
// until that generator lands the cross-check skips on absence.
val copyLitePresets by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/preset/agent-presets/lite-preset-descriptors.json"))
    into(layout.buildDirectory.dir("lite-presets"))
}

// Copy the generated lite tool-schema projection straight from the core tools
// package so the schema catalog test compares against the current candidate
// bytes; until that generator lands the projection test skips on absence.
val copyLiteToolSchemas by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.parentFile.resolve("packages/core/tools/lite-tool-schemas.json"))
    into(layout.buildDirectory.dir("lite-tool-schemas"))
}

sourceSets.test {
    resources.srcDir(copyToolDescriptors)
    resources.srcDir(copyLitePresets)
    resources.srcDir(copyLiteToolSchemas)
}

tasks.register<JavaExec>("nativeAcceptance") {
    group = "verification"
    description = "Runs the Kotlin Link client against the real Host acceptance corpus."
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("ai.deepseek.dsh.link.LinkNativeAcceptance")
}

// The Host integration runner launches the compiled Kotlin driver directly;
// pairing secrets travel through its private stdin pipe, never task arguments.
tasks.register("nativeGatewayClasspath") {
    dependsOn(tasks.named("testClasses"))
    val output = layout.buildDirectory.file("native-gateway-classpath.txt")
    outputs.file(output)
    doLast { output.get().asFile.writeText(sourceSets["test"].runtimeClasspath.asPath) }
}
