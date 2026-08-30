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
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
