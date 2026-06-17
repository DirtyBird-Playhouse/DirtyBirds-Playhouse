# Gson
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.dirtybirds.companion.data.api.ClaudeApiService$* { *; }
-keep class com.dirtybirds.companion.data.model.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Room
-keep class * extends androidx.room.RoomDatabase
