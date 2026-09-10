package ai.deepseek.dsh.link

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Required description fields cannot become fabricated version or capability observations. */
class HostDescriptionParsingTest {
    private val valid = Json.parseToJsonElement("""{
      "linkProtocolVersion":1,"contractVersion":1,"sessionFormatVersion":0,
      "hostVersion":"0.1.2-alpha.1","hostId":"private-host-id","hostName":"private-host-name","runtimeClass":"full",
      "allowRemoteApproval":false,"capabilities":{
        "session":{"list":true,"history":true,"follow":true,"prompt":true,"cancel":true},
        "workspace":{"follow":true},"interaction":{"approval":false,"question":true}}
    }""").jsonObject

    private fun changed(path: String, replacement: JsonElement?): JsonObject {
        fun replace(value: JsonObject, parts: List<String>): JsonObject {
            val fields = value.toMutableMap(); val key = parts.first()
            if (parts.size > 1) fields[key] = replace(fields.getValue(key).jsonObject, parts.drop(1))
            else if (replacement == null) fields.remove(key) else fields[key] = replacement
            return JsonObject(fields)
        }
        return replace(valid, path.split('.'))
    }

    @Test fun retainsExplicitZeroFalseAndUnknownOptionalFields() {
        val description = mapHostDescription(JsonObject(valid + ("futureField" to JsonObject(emptyMap()))))
        assertEquals(0.0, description.sessionFormatVersion)
        assertEquals(false, description.allowRemoteApproval)
        assertEquals(false, description.capabilities.interaction.approval)
        assertEquals(true, description.capabilities.session.follow)
    }

    @Test fun rejectsAbsentAndMistypedRequiredVersionNumbers() {
        for (name in listOf("linkProtocolVersion", "contractVersion", "sessionFormatVersion")) {
            for (replacement in listOf(null, JsonNull, JsonPrimitive("1"), JsonPrimitive(true), JsonObject(emptyMap()), Json.parseToJsonElement("1e309"))) {
                assertFailsWith<LinkClientException.BadWire>(name) { mapHostDescription(changed(name, replacement)) }
            }
        }
    }

    @Test fun rejectsAbsentAndMistypedRequiredCapabilityFlags() {
        val paths = listOf("allowRemoteApproval", "capabilities.session.list", "capabilities.session.history",
            "capabilities.session.follow", "capabilities.session.prompt", "capabilities.session.cancel",
            "capabilities.workspace.follow", "capabilities.interaction.approval", "capabilities.interaction.question")
        for (name in paths) {
            for (replacement in listOf(null, JsonNull, JsonPrimitive("false"), JsonPrimitive(0), JsonObject(emptyMap()))) {
                assertFailsWith<LinkClientException.BadWire>(name) { mapHostDescription(changed(name, replacement)) }
            }
        }
    }

    @Test fun rejectsAbsentAndMistypedRequiredCapabilityObjects() {
        for (name in listOf("capabilities", "capabilities.session", "capabilities.workspace", "capabilities.interaction")) {
            for (replacement in listOf(null, JsonNull, JsonPrimitive(false), JsonPrimitive("private payload"))) {
                assertFailsWith<LinkClientException.BadWire>(name) { mapHostDescription(changed(name, replacement)) }
            }
        }
    }
}
