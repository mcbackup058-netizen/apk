#!/bin/bash
# Quick APK build script (requires Android SDK)

ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}
BUILD_TOOLS=$ANDROID_HOME/build-tools/34.0.0
PLATFORM=$ANDROID_HOME/platforms/android-34

# Create temp directory
mkdir -p temp/apk/res temp/apk/assets temp/apk/dex

# Copy assets
cp index.html temp/apk/assets/

# Create AndroidManifest.xml
cat > temp/AndroidManifest.xml << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.mc.manager" android:versionCode="1" android:versionName="1.0">
    <uses-permission android:name="android.permission.INTERNET"/>
    <application android:label="MC Manager" android:usesCleartextTraffic="true">
        <activity android:name="MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
    </application>
</manifest>
XML

echo "Run: $BUILD_TOOLS/aapt package -f -M temp/AndroidManifest.xml -S temp/apk/res -I $PLATFORM/android.jar -F temp/app.apk"
echo "Then add assets and dex files"
