// Link the exact scanner archive for Go's executable build-info reader.
#import "DSHSupportscanner.objc.h"

int main(void) {
    @autoreleasepool {
        return DSHSupportscannerRulesDigest().length == 64 ? 0 : 1;
    }
}
