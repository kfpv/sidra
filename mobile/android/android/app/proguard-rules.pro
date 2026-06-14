# Keep Capacitor and WebView JavaScript interfaces
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers for crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
