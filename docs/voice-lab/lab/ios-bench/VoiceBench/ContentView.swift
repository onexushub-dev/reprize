import SwiftUI
import UIKit

@main
struct VoiceBenchApp: App {
  @StateObject private var model = BenchModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .onAppear { model.requestPermissions() }
    }
  }
}

/// One screen: pick the mode, start, watch the two counters, stop. Sessions land in Files → VoiceBench.
struct ContentView: View {
  @EnvironmentObject private var model: BenchModel
  @State private var share: ShareItem?
  @State private var exportError: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Modo", selection: $model.mode) {
            ForEach(BenchMode.allCases) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          switch model.mode {
          case .acerto:
            Picker("Distância", selection: $model.distance) {
              ForEach(BenchModel.distances, id: \.self) { Text("\($0) m").tag($0) }
            }
            .pickerStyle(.segmented)
            TextField("Quem fala", text: $model.speaker)
              .textInputAutocapitalization(.words)
            Stepper("Falas esperadas: \(model.expected)", value: $model.expected, in: 1...20)
          case .ruido:
            Text("Jogo normal, sem ninguém falar \"salvar\".")
              .foregroundStyle(.secondary)
          case .parecidas:
            Picker("Distância", selection: $model.distance) {
              ForEach(BenchModel.distances, id: \.self) { Text("\($0) m").tag($0) }
            }
            .pickerStyle(.segmented)
            TextField("Quem fala", text: $model.speaker)
              .textInputAutocapitalization(.words)
            Text("Cada palavra 5 vezes, ~2 s entre elas. Nunca \"salvar\": todo disparo aqui é confusão.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          case .consumo:
            Picker("Motor", selection: $model.perfChoice) {
              ForEach(PerfChoice.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            Picker("Duração", selection: $model.perfMinutes) {
              Text("10 min").tag(10)
              Text("2 min (teste)").tag(2)
            }
            .pickerStyle(.segmented)
            Text("Fora da tomada, mesmo lugar, celular frio. Brilho fixo em 50% durante a rodada.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
        .disabled(model.running)

        if model.mode == .parecidas {
          Section("Palavras (5× cada)") {
            Text(BenchModel.confusers.joined(separator: " · "))
              .font(.title3)
          }
        }

        Section {
          HStack(spacing: 12) {
            counter("Atual", model.atual, flash: model.flashAtual, color: .orange)
            if model.hasBase {
              counter("rc1", model.base, flash: model.flashBase, color: .purple)
            }
            counter(model.hasBase ? "rc4" : "Novo", model.novo, flash: model.flashNovo, color: .blue)
          }
          .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
          Text(clock)
            .font(.system(.title2, design: .monospaced))
            .frame(maxWidth: .infinity)
          Text(model.hasBase ? "rc4 = \(model.modelVersion) · rc1 = o mesmo sem o veto (mesmo áudio)"
                             : "Novo = \(model.modelVersion)")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
          Button(model.running ? "Parar" : "Iniciar") {
            if model.running { model.stop() } else { model.start() }
          }
          .font(.title3.bold())
          .frame(maxWidth: .infinity, minHeight: 44)
          .foregroundStyle(model.running ? Color.red : (model.canStart ? Color.accentColor : Color.secondary))
          .disabled(!model.running && !model.canStart)
          if !model.running && !model.canStart {
            Text("Preencha quem fala para iniciar.").font(.footnote).foregroundStyle(.secondary)
          }
          if !model.status.isEmpty {
            Text(model.status).font(.footnote).foregroundStyle(.secondary)
          }
        }

        Section {
          Button {
            exportAll()
          } label: {
            Label("Exportar todas (AirDrop)", systemImage: "square.and.arrow.up")
              .frame(maxWidth: .infinity, minHeight: 44)
          }
          .disabled(model.running || model.sessions.isEmpty)
          if let exportError {
            Text(exportError).font(.footnote).foregroundStyle(.red)
          }
        } footer: {
          Text("Um .zip com o .json e o .m4a de cada sessão. Toque numa sessão para enviar só ela.")
        }

        Section("Sessões salvas") {
          if model.sessions.isEmpty {
            Text("Nenhuma ainda").foregroundStyle(.secondary)
          }
          ForEach(Array(model.sessions.enumerated()), id: \.offset) { _, s in
            Button {
              share = ShareItem(urls: SessionStore.files(of: s))
            } label: {
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(title(s)).font(.subheadline.bold()).foregroundStyle(.primary)
                  Text(detail(s)).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "square.and.arrow.up").foregroundStyle(.secondary)
              }
            }
            .disabled(model.running)
          }
        }
      }
      .navigationTitle("VoiceBench")
      .sheet(item: $share) { item in
        ShareSheet(urls: item.urls)
      }
    }
  }

  private func exportAll() {
    exportError = nil
    do {
      share = ShareItem(urls: [try SessionStore.zipAll()])
    } catch {
      exportError = "Não consegui criar o .zip: \(error.localizedDescription)"
    }
  }

  private var clock: String {
    let s = Int(model.elapsed)
    return String(format: "%02d:%02d", s / 60, s % 60)
  }

  private func counter(_ label: String, _ value: Int, flash: Bool, color: Color) -> some View {
    VStack(spacing: 4) {
      Text(label).font(.headline)
      Text("\(value)").font(.system(size: model.hasBase ? 52 : 64, weight: .bold, design: .rounded)).monospacedDigit()
    }
    .frame(maxWidth: .infinity, minHeight: 130)
    .background(flash ? color.opacity(0.45) : color.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    .accessibilityElement(children: .combine)
  }

  private func title(_ s: BenchSession) -> String {
    switch s.kind {
    case "accuracy": return "Acerto · \(s.speaker ?? "?") · \(s.distance ?? 0) m"
    case "noise": return "Ruído"
    case "confusers": return "Parecidas · \(s.speaker ?? "?") · \(s.distance ?? 0) m"
    default: return "Consumo · \(s.perfEngine ?? "?")"
    }
  }

  private func detail(_ s: BenchSession) -> String {
    let atual = s.events.filter { $0.engine == "dictation" }.count
    let novo = s.events.filter { $0.engine == "keyword" }.count
    let base = s.events.filter { $0.engine == "keyword-main" }.count
    let minutes = String(format: "%.1f min", s.durationSec / 60)
    let expected = s.expected.map { " de \($0)" } ?? ""
    let issues = (s.issues ?? []).isEmpty ? "" : " · ⚠︎ \((s.issues ?? []).count) aviso(s)"
    let rc1 = s.events.contains { $0.engine == "keyword-main" } ? "rc1 \(base)\(expected) · " : ""
    return "Atual \(atual)\(expected) · \(rc1)Novo \(novo)\(expected) · \(minutes)\(issues) · \(s.start)"
  }
}

struct ShareItem: Identifiable {
  let id = UUID()
  let urls: [URL]
}

/// The system share sheet (AirDrop first when a Mac is nearby).
struct ShareSheet: UIViewControllerRepresentable {
  let urls: [URL]

  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: urls, applicationActivities: nil)
  }

  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
