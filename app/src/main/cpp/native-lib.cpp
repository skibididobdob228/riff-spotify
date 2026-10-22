// Starts nodejs-mobile's Node.js inside the app process and forwards its stdout/stderr to logcat.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

namespace {

int stdoutPipe[2];
int stderrPipe[2];

void *pump(void *arg) {
    int which = *static_cast<int *>(arg);
    int fd = which == 1 ? stdoutPipe[0] : stderrPipe[0];
    int priority = which == 1 ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR;
    char buf[2048];
    std::string line;
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf))) > 0) {
        line.append(buf, static_cast<size_t>(n));
        size_t pos;
        while ((pos = line.find('\n')) != std::string::npos) {
            __android_log_write(priority, "RiffNode", line.substr(0, pos).c_str());
            line.erase(0, pos + 1);
        }
    }
    return nullptr;
}

void redirectOutputToLogcat() {
    static int out = 1, err = 2;
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(stdoutPipe);
    pipe(stderrPipe);
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stderrPipe[1], STDERR_FILENO);
    pthread_t t1, t2;
    pthread_create(&t1, nullptr, pump, &out);
    pthread_create(&t2, nullptr, pump, &err);
    pthread_detach(t1);
    pthread_detach(t2);
}

std::string toString(JNIEnv *env, jstring s) {
    const char *chars = env->GetStringUTFChars(s, nullptr);
    std::string out(chars);
    env->ReleaseStringUTFChars(s, chars);
    return out;
}

}  // namespace

// envPairs is [key0, value0, key1, value1, ...]; node::Start never returns while the server runs
extern "C" JNIEXPORT jint JNICALL
Java_io_github_skibididobdob228_riffspotify_NodeRunner_startNode(JNIEnv *env, jclass, jobjectArray args, jobjectArray envPairs) {
    jsize envCount = env->GetArrayLength(envPairs);
    for (jsize i = 0; i + 1 < envCount; i += 2) {
        std::string key = toString(env, static_cast<jstring>(env->GetObjectArrayElement(envPairs, i)));
        std::string value = toString(env, static_cast<jstring>(env->GetObjectArrayElement(envPairs, i + 1)));
        setenv(key.c_str(), value.c_str(), 1);
    }

    // node::Start wants all arguments in one contiguous buffer
    jsize argc = env->GetArrayLength(args);
    std::vector<std::string> strings;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        strings.push_back(toString(env, static_cast<jstring>(env->GetObjectArrayElement(args, i))));
        total += strings.back().size() + 1;
    }
    char *buffer = static_cast<char *>(calloc(total, 1));
    std::vector<char *> argv;
    char *cursor = buffer;
    for (const std::string &s : strings) {
        memcpy(cursor, s.c_str(), s.size());
        argv.push_back(cursor);
        cursor += s.size() + 1;
    }

    redirectOutputToLogcat();
    return node::Start(argc, argv.data());
}
