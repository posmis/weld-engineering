using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

// Transport example only. It does not require Inventor and is not an add-in.
var tokenPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WeldEngineering", "api-1421.token");
using var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:1421"), Timeout = TimeSpan.FromSeconds(20) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await File.ReadAllTextAsync(tokenPath)).Trim());
var input = new {
    schema_version = 1,
    segments = new[] { new { start_mm = new[] { -50.0, 0.0 }, end_mm = new[] { 50.0, 0.0 }, effective_width_mm = 2.0 } },
    force_n = new[] { 400.0, -200.0, 600.0 },
    couple_n_mm = new[] { 0.0, 0.0, 0.0 },
    application = new { kind = "centroid" }
};
using var response = await http.PostAsJsonAsync("/api/v1/calculate", input);
using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
if (!response.IsSuccessStatusCode) {
    throw new InvalidOperationException($"Calculation failed: HTTP {(int)response.StatusCode}; {document.RootElement}");
}
var result = document.RootElement;
Console.WriteLine($"Analysis: {result.GetProperty("analysis_status").GetString()}");
Console.WriteLine($"Strength: {result.GetProperty("strength_status").GetString()}");
Console.WriteLine($"Validation: {result.GetProperty("validation_status").GetString()}");
if (result.GetProperty("traction_mpa").ValueKind == JsonValueKind.Array) {
    Console.WriteLine($"Nominal components [MPa]: {result.GetProperty("traction_mpa")}");
}
// Never interpret computed as passed. Keep unsupported/partial cases visible.
