package com.dirtybirds.companion.data.api

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class ClaudeApiService(private val apiKey: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    data class ApiMessage(
        val role: String,
        val content: String
    )

    data class ApiRequest(
        val model: String = "claude-sonnet-4-6",
        @SerializedName("max_tokens") val maxTokens: Int = 1024,
        val system: String,
        val messages: List<ApiMessage>
    )

    data class ContentBlock(val text: String?)

    data class ApiResponse(val content: List<ContentBlock>?)

    data class ApiError(val error: ErrorDetail?)
    data class ErrorDetail(val message: String?)

    suspend fun sendMessage(
        systemPrompt: String,
        conversationHistory: List<ApiMessage>
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val request = ApiRequest(
                system = systemPrompt,
                messages = conversationHistory
            )

            val jsonBody = gson.toJson(request)
            val httpRequest = Request.Builder()
                .url("https://api.anthropic.com/v1/messages")
                .addHeader("x-api-key", apiKey)
                .addHeader("anthropic-version", "2023-06-01")
                .addHeader("content-type", "application/json")
                .post(jsonBody.toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(httpRequest).execute()
            val body = response.body?.string() ?: ""

            if (response.isSuccessful) {
                val apiResponse = gson.fromJson(body, ApiResponse::class.java)
                val text = apiResponse.content?.firstOrNull()?.text
                if (text != null) {
                    Result.success(text)
                } else {
                    Result.failure(Exception("Empty response from API"))
                }
            } else {
                val error = try {
                    gson.fromJson(body, ApiError::class.java)
                } catch (_: Exception) { null }
                Result.failure(
                    Exception(error?.error?.message ?: "API error: ${response.code}")
                )
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
