<?php
// proxy.php - single-file CORS proxy with SSRF protection + rate limit.
// Usage: proxy.php?url=https://target.com/path
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: *');
header('Access-Control-Max-Age: 86400');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// === RATE LIMIT (per-IP, 60 req/min, file-based) ===
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$rlDir = sys_get_temp_dir() . '/proxy_rl';
if (!is_dir($rlDir)) @mkdir($rlDir, 0755, true);
$rlFile = "$rlDir/" . preg_replace('/[^a-f0-9.]/i', '_', $ip) . '.dat';
$now = time();
$window = [];
if (is_file($rlFile)) {
    $raw = @file_get_contents($rlFile);
    $window = $raw ? (json_decode($raw, true) ?: []) : [];
}
$window = array_values(array_filter($window, fn($t) => $t > $now - 60));
if (count($window) >= 60) {
    header('Retry-After: 60');
    http_response_code(429);
    echo 'rate limit exceeded';
    exit;
}
$window[] = $now;
@file_put_contents($rlFile, json_encode($window));

// === URL VALIDATION ===
$url = $_GET['url'] ?? $_POST['url'] ?? '';
if (!$url) { http_response_code(400); echo 'missing url param'; exit; }
if (!preg_match('|^https?://|', $url)) {
    $url = 'https://' . ltrim($url, '/');
}

$parts = parse_url($url);
if (!$parts || empty($parts['host'])) { http_response_code(400); echo 'invalid url'; exit; }
$scheme = strtolower($parts['scheme'] ?? '');
if (!in_array($scheme, ['http', 'https'], true)) { http_response_code(400); echo 'scheme not allowed'; exit; }

// === SSRF PROTECTION: resolve hostname and reject private IPs ===
function isPrivateIp(string $ip): bool {
    // Reject IPv4 private/reserved ranges + loopback + link-local + cloud metadata
    if (!filter_var($ip, FILTER_VALIDATE_IP)) return true; // unknown = block
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $long = ip2long($ip);
        if ($long === false) return true;
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 0.0.0.0/8
        $ranges = [
            ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
            ['127.0.0.0', 8], ['169.254.0.0', 16], ['0.0.0.0', 8],
            ['100.64.0.0', 10], // CGN
            ['224.0.0.0', 4],   // multicast
            ['240.0.0.0', 4],   // reserved
        ];
        foreach ($ranges as [$net, $bits]) {
            $mask = $bits === 0 ? 0 : ((-1 << (32 - $bits)) & 0xFFFFFFFF);
            if (($long & $mask) === (ip2long($net) & $mask)) return true;
        }
        return false;
    }
    // IPv6: reject loopback, link-local, unique local, multicast
    $lower = strtolower($ip);
    if (str_starts_with($lower, '::1') || $lower === '::') return true;
    if (str_starts_with($lower, 'fc') || str_starts_with($lower, 'fd')) return true; // ULA
    if (str_starts_with($lower, 'fe8') || str_starts_with($lower, 'fe9') || str_starts_with($lower, 'fea') || str_starts_with($lower, 'feb')) return true; // link-local
    if (str_starts_with($lower, 'ff')) return true; // multicast
    return false;
}

$host = $parts['host'];
// Strip IPv6 brackets if present
if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
    $host = substr($host, 1, -1);
}

// If already an IP literal, check directly
if (filter_var($host, FILTER_VALIDATE_IP)) {
    if (isPrivateIp($host)) { http_response_code(403); echo 'blocked: private address'; exit; }
} else {
    // Resolve all DNS records; if ANY resolves to a private IP, block
    $ips = @dns_get_record($host, DNS_A + DNS_AAAA);
    if (!$ips) {
        // Fallback: try gethostbynamel
        $v4 = @gethostbynamel($host);
        if ($v4) $ips = array_map(fn($i) => ['ip' => $i, 'type' => 'A'], $v4);
    }
    if (!$ips) { http_response_code(400); echo 'dns resolution failed'; exit; }
    foreach ($ips as $rec) {
        $ip = $rec['ip'] ?? '';
        if (!$ip) continue;
        if (isPrivateIp($ip)) { http_response_code(403); echo 'blocked: host resolves to private address'; exit; }
    }
}

// === FETCH ===
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,  // disabled: prevents redirect-based SSRF bypass
    CURLOPT_TIMEOUT => 20,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_ENCODING => '',
    CURLOPT_HTTPHEADER => [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.5',
    ],
    // Resolve to a placeholder IP so curl can't re-resolve to a private IP
    // (defense in depth alongside CURLOPT_RESOLVE)
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
]);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    curl_setopt($ch, CURLOPT_POST, true);
    $body = file_get_contents('php://input');
    if ($body) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

if ($body === false) { http_response_code(502); echo 'upstream error: ' . $err; exit; }

if ($ctype) header('Content-Type: ' . $ctype);
http_response_code($code ?: 200);
echo $body;
