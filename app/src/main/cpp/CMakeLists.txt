cmake_minimum_required(VERSION 3.22)
project(riffnode CXX)

set(LIBNODE_DIR ${CMAKE_SOURCE_DIR}/../../../libnode)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${LIBNODE_DIR}/bin/${ANDROID_ABI}/libnode.so)

add_library(riffnode SHARED native-lib.cpp)
target_include_directories(riffnode PRIVATE ${LIBNODE_DIR}/include/node)
find_library(log-lib log)
target_link_libraries(riffnode node ${log-lib})
