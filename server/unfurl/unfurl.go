package unfurl

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

type UnfurlResult struct {
	URL         string
	SiteName    *string
	Title       *string
	Description *string
	ImageURL    *string
	Success     bool
}

var urlRegex = regexp.MustCompile(`https?://[^\s<>"'` + "`" + `]+`)

// ExtractURLs extracts HTTP(S) URLs from message content, stripping trailing punctuation.
func ExtractURLs(content string) []string {
	matches := urlRegex.FindAllString(content, -1)
	seen := map[string]bool{}
	var urls []string
	for _, u := range matches {
		// Strip trailing punctuation (same logic as frontend Message.tsx)
		for len(u) > 1 && trailingPunct(u[len(u)-1]) {
			u = u[:len(u)-1]
		}
		if !seen[u] {
			seen[u] = true
			urls = append(urls, u)
		}
	}
	// Limit to 5 URLs per message
	if len(urls) > 5 {
		urls = urls[:5]
	}
	return urls
}

func trailingPunct(b byte) bool {
	switch b {
	case '.', ',', ';', ':', '!', '?', ')', '>', ']':
		return true
	}
	return false
}

// isPrivateIP checks if an IP is in a private/reserved range.
func isPrivateIP(ip net.IP) bool {
	privateRanges := []string{
		"127.0.0.0/8",
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16",
		"0.0.0.0/8",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	// IPv6 loopback and private
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	// fc00::/7 (unique local)
	if len(ip) == net.IPv6len && (ip[0]&0xfe) == 0xfc {
		return true
	}
	return false
}

// checkHostSSRF resolves a hostname and rejects private IPs.
func checkHostSSRF(hostname string) error {
	// Strip port if present
	host := hostname
	if h, _, err := net.SplitHostPort(hostname); err == nil {
		host = h
	}

	ips, err := net.LookupHost(host)
	if err != nil {
		return fmt.Errorf("dns lookup failed: %w", err)
	}

	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if isPrivateIP(ip) {
			return fmt.Errorf("private IP blocked: %s", ipStr)
		}
	}
	return nil
}

// FetchUnfurls fetches Open Graph metadata for a list of URLs.
func FetchUnfurls(urls []string) []UnfurlResult {
	results := make([]UnfurlResult, len(urls))

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 2 {
				return fmt.Errorf("too many redirects")
			}
			// SSRF check each redirect hop
			if err := checkHostSSRF(req.URL.Host); err != nil {
				return err
			}
			return nil
		},
	}

	for i, u := range urls {
		results[i] = fetchOne(client, u)
	}
	return results
}

// oEmbed endpoint patterns for sites that block OG scraping
var oEmbedEndpoints = []struct {
	hostMatch string
	endpoint  string
}{
	{"youtube.com", "https://www.youtube.com/oembed"},
	{"youtu.be", "https://www.youtube.com/oembed"},
	{"vimeo.com", "https://vimeo.com/api/oembed.json"},
	{"reddit.com", "https://www.reddit.com/oembed"},
	{"twitter.com", "https://publish.twitter.com/oembed"},
	{"x.com", "https://publish.twitter.com/oembed"},
}

// getOEmbedEndpoint returns the oEmbed API URL for a given hostname, or empty string.
func getOEmbedEndpoint(hostname string) string {
	h := strings.ToLower(hostname)
	for _, e := range oEmbedEndpoints {
		if h == e.hostMatch || strings.HasSuffix(h, "."+e.hostMatch) {
			return e.endpoint
		}
	}
	return ""
}

type oEmbedResponse struct {
	Title        string `json:"title"`
	AuthorName   string `json:"author_name"`
	ProviderName string `json:"provider_name"`
	ThumbnailURL string `json:"thumbnail_url"`
	Description  string `json:"description"`
}

// fetchOEmbed tries the oEmbed API for known providers.
func fetchOEmbed(client *http.Client, rawURL, hostname string) *UnfurlResult {
	endpoint := getOEmbedEndpoint(hostname)
	if endpoint == "" {
		return nil
	}

	oembedURL := endpoint + "?url=" + url.QueryEscape(rawURL) + "&format=json"
	req, err := http.NewRequest("GET", oembedURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "LeFauxPain/1.0 LinkPreview")

	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil
	}

	var oe oEmbedResponse
	if err := json.Unmarshal(body, &oe); err != nil {
		return nil
	}

	if oe.Title == "" {
		return nil
	}

	result := &UnfurlResult{URL: rawURL, Success: true}
	result.Title = &oe.Title

	siteName := oe.ProviderName
	if siteName == "" {
		siteName = hostname
	}
	result.SiteName = &siteName

	if oe.AuthorName != "" {
		result.Description = &oe.AuthorName
	}

	return result
}

func fetchOne(client *http.Client, rawURL string) UnfurlResult {
	result := UnfurlResult{URL: rawURL}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		log.Printf("unfurl: bad url %q: %v", rawURL, err)
		return result
	}

	// SSRF check before fetching
	if err := checkHostSSRF(parsed.Host); err != nil {
		log.Printf("unfurl: SSRF blocked %q: %v", rawURL, err)
		return result
	}

	// Try oEmbed first for known providers (YouTube, Vimeo, etc.)
	if oe := fetchOEmbed(client, rawURL, parsed.Hostname()); oe != nil {
		log.Printf("unfurl: oEmbed success for %q: %q", rawURL, *oe.Title)
		oe.Title = truncPtr(oe.Title, 500)
		oe.Description = truncPtr(oe.Description, 1000)
		oe.SiteName = truncPtr(oe.SiteName, 200)
		return *oe
	}

	// Fall back to OG scraping
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return result
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; LeFauxPain/1.0; +https://lefauxpain.com)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := client.Do(req)
	if err != nil {
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") && !strings.Contains(ct, "application/xhtml") {
		return result
	}

	// Read max 1MB
	body := io.LimitReader(resp.Body, 1<<20)
	og := parseOG(body, parsed.Hostname())

	if og.title != nil || og.description != nil || og.siteName != nil {
		result.Title = truncPtr(og.title, 500)
		result.Description = truncPtr(og.description, 1000)
		result.SiteName = truncPtr(og.siteName, 200)
		result.ImageURL = truncPtr(og.imageURL, 2000)
		result.Success = true
	}
	return result
}

type ogData struct {
	title       *string
	description *string
	siteName    *string
	imageURL    *string
	htmlTitle   *string
}

func parseOG(r io.Reader, hostname string) ogData {
	var og ogData
	tokenizer := html.NewTokenizer(r)

	for {
		tt := tokenizer.Next()
		switch tt {
		case html.ErrorToken:
			goto done
		case html.StartTagToken, html.SelfClosingTagToken:
			tn, hasAttr := tokenizer.TagName()
			tagName := string(tn)

			if tagName == "meta" && hasAttr {
				var property, content string
				for {
					key, val, more := tokenizer.TagAttr()
					k := string(key)
					v := string(val)
					if k == "property" || k == "name" {
						property = v
					}
					if k == "content" {
						content = v
					}
					if !more {
						break
					}
				}
				switch property {
				case "og:title":
					og.title = &content
				case "og:description":
					og.description = &content
				case "og:site_name":
					og.siteName = &content
				case "og:image":
					og.imageURL = &content
				}
			}

			if tagName == "title" {
				// Read next token for title text
				tt = tokenizer.Next()
				if tt == html.TextToken {
					t := strings.TrimSpace(string(tokenizer.Text()))
					if t != "" {
						og.htmlTitle = &t
					}
				}
			}

			// Stop parsing after </head> — no need to parse body
			if tagName == "body" {
				goto done
			}
		}
	}

done:
	// Fallback: use <title> if no og:title
	if og.title == nil && og.htmlTitle != nil {
		og.title = og.htmlTitle
	}
	// Fallback: use hostname as site_name
	if og.siteName == nil && hostname != "" {
		og.siteName = &hostname
	}
	return og
}

func truncPtr(s *string, max int) *string {
	if s == nil {
		return nil
	}
	v := *s
	if len(v) > max {
		v = v[:max]
	}
	return &v
}
