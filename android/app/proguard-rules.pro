# GrabCycle release shrinking rules.

# Firestore maps documents onto these POJOs by reflection (public fields +
# no-arg constructors). Keep their members.
-keep class ph.grabcycle.app.model.** { *; }
-keepclassmembers class ph.grabcycle.app.model.** { public <init>(); }

# Keep line numbers for crash reports without exposing source file names.
-keepattributes SourceFile,LineNumberTable,Signature,*Annotation*
-renamesourcefileattribute SourceFile
