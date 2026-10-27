#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

static BOOL matches(NSString *value, NSString *pattern) {
  return value && [value rangeOfString:pattern options:NSRegularExpressionSearch].location != NSNotFound;
}
static int fail(void) { fputs("KEYCHAIN_UNAVAILABLE\n", stderr); return 1; }
static void wipe(void *memory, size_t length) { volatile unsigned char *bytes = memory; while (length--) *bytes++ = 0; }
static int lockJournal(void) {
  NSString *root = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/Corely/Mailroom Print Agent"];
  struct stat directory;
  if (lstat(root.fileSystemRepresentation, &directory) || !S_ISDIR(directory.st_mode) || directory.st_uid != getuid() || (directory.st_mode & 0777) != 0700) return 73;
  NSString *path = [root stringByAppendingPathComponent:@"journal.lock"];
  int fd = open(path.fileSystemRepresentation, O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
  struct stat file;
  if (fd < 0 || fstat(fd, &file) || !S_ISREG(file.st_mode) || file.st_uid != getuid() || (file.st_mode & 0777) != 0600 || flock(fd, LOCK_EX | LOCK_NB)) { if (fd >= 0) close(fd); return 73; }
  fputs("LOCKED\n", stdout); fflush(stdout);
  char byte;
  while (1) { ssize_t count = read(STDIN_FILENO, &byte, 1); if (!count) break; if (count < 0 && errno != EINTR) break; }
  close(fd); return 0;
}
int main(int argc, const char **argv) { @autoreleasepool {
  if (argc == 2 && strcmp(argv[1], "lock") == 0) return lockJournal();
  if (argc != 3) return fail();
  NSString *action = [NSString stringWithUTF8String:argv[1]], *account = [NSString stringWithUTF8String:argv[2]];
  if (account.length != 36 || !matches(account, @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$") || !([action isEqual:@"get"] || [action isEqual:@"put"])) return fail();
  NSMutableDictionary *query = [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: @"cc.corely.mailroom-print-agent.dev", (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecAttrSynchronizable: @NO} mutableCopy];
  if ([action isEqual:@"put"]) {
    char bytes[66]; size_t length = 0;
    while (length < sizeof(bytes)) { ssize_t count = read(STDIN_FILENO, bytes + length, sizeof(bytes) - length); if (!count) break; if (count < 0) { if (errno == EINTR) continue; wipe(bytes, sizeof(bytes)); return fail(); } length += (size_t)count; }
    if (length && bytes[length-1] == '\n') length--;
    if (length && bytes[length-1] == '\r') length--;
    NSString *secret = [[NSString alloc] initWithBytes:bytes length:length encoding:NSUTF8StringEncoding];
    if (length != 43 || !matches(secret, @"^[A-Za-z0-9_-]{43}$")) { wipe(bytes, sizeof(bytes)); return fail(); }
    NSData *data = [NSData dataWithBytes:bytes length:length]; wipe(bytes, sizeof(bytes));
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData:data});
    if (status == errSecItemNotFound) { query[(__bridge id)kSecValueData] = data; query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; status = SecItemAdd((__bridge CFDictionaryRef)query, NULL); }
    return status == errSecSuccess ? 0 : fail();
  }
  if (fcntl(3, F_GETFD) == -1) return fail();
  query[(__bridge id)kSecReturnData] = @YES; query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef result = NULL; OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status != errSecSuccess || !result) return fail();
  NSData *data = CFBridgingRelease(result); NSString *secret = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (data.length != 43 || !matches(secret, @"^[A-Za-z0-9_-]{43}$")) return fail();
  const char *bytes = data.bytes; size_t sent = 0;
  while (sent < data.length) { ssize_t count = write(3, bytes + sent, data.length - sent); if (count < 0 && errno == EINTR) continue; if (count <= 0) return fail(); sent += (size_t)count; }
  return 0;
} }
