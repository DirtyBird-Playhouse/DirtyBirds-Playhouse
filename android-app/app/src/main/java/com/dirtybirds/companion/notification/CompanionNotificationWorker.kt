package com.dirtybirds.companion.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dirtybirds.companion.MainActivity
import com.dirtybirds.companion.R
import com.dirtybirds.companion.data.db.AppDatabase
import java.util.concurrent.TimeUnit

class CompanionNotificationWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val db = AppDatabase.getInstance(applicationContext)
        val companion = db.companionDao().getCompanionSync()
        val name = companion?.name ?: "Luna"

        val greetings = listOf(
            "Good morning! $name is thinking about you 💭",
            "Hey! $name wants to chat 💕",
            "$name misses you! Come say hi 👋",
            "Rise and shine! $name has something to tell you ✨",
            "$name is in a great mood today! Come chat 😊",
            "Don't forget about $name! They're waiting for you 🥺"
        )

        val message = greetings.random()
        showNotification(name, message)

        return Result.success()
    }

    private fun showNotification(name: String, message: String) {
        val channelId = "companion_greetings"
        val notificationManager = applicationContext
            .getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val channel = NotificationChannel(
            channelId,
            "Daily Greetings",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Daily messages from your companion"
        }
        notificationManager.createNotificationChannel(channel)

        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, channelId)
            .setSmallIcon(R.drawable.ic_heart)
            .setContentTitle(name)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(1001, notification)
    }

    companion object {
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CompanionNotificationWorker>(
                12, TimeUnit.HOURS
            ).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "companion_greeting",
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork("companion_greeting")
        }
    }
}
