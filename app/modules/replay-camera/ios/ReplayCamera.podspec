Pod::Spec.new do |s|
  s.name           = 'ReplayCamera'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = ["Core/Package.swift", "Core/Tests/**/*", "Core/.build/**/*"]
  # Seguir a Bola's ball detector (ball_tiny_gym, YOLOX-Tiny 416), compiled from the lab's .mlpackage with
  # `xcrun coremlcompiler compile`; BallAnalyzer looks for it in this bundle.
  # Voice "salvar" detector (plan 2026-11-24, Phase 2): the model behind the Diagnóstico switch, flattened into the same
  # bundle (detector.json, mel_filterbank.bin, classifier.bin) next to voice_embedding.mlmodelc. One version at a time.
  s.resource_bundles = { "ReplayCameraModels" => ["Models/*.mlmodelc", "Models/voice/salvar-v2-rc1/*"] }
end
