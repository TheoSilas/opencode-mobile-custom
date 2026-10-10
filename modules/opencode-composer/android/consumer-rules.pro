# Expo creates this AppCompatEditText subclass through reflection. Expo's
# default constructor rules cover ExpoView subclasses only; without this rule
# R8 makes this class abstract and removes its Context constructor in release.
-keep class app.getopencode.composer.ImageKeyboardEditText {
  public <init>(android.content.Context);
}
