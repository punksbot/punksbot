cmake_minimum_required(VERSION 3.29)
set(CMAKE_OSX_SYSROOT macosx CACHE STRING "macOS SDK" FORCE)
project(PunksPromotionDriver LANGUAGES Swift)

enable_testing()
find_package(XCTest REQUIRED)

add_executable(PunksPromotionHarness MACOSX_BUNDLE Dummy.swift)
set_target_properties(
  PunksPromotionHarness
  PROPERTIES
    MACOSX_BUNDLE_GUI_IDENTIFIER bot.punks.promotion-driver.harness
    XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED NO
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER bot.punks.promotion-driver.harness
)

xctest_add_bundle(
  PunksPromotionUITests
  PunksPromotionHarness
  PunksPromotionUITests.swift
)
set_target_properties(
  PunksPromotionUITests
  PROPERTIES
    XCODE_PRODUCT_TYPE com.apple.product-type.bundle.ui-testing
    XCODE_ATTRIBUTE_BUNDLE_LOADER ""
    XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED NO
    XCODE_ATTRIBUTE_TEST_HOST ""
    XCODE_ATTRIBUTE_TEST_TARGET_NAME ""
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER bot.punks.promotion-driver.tests
    XCODE_GENERATE_SCHEME TRUE
)
