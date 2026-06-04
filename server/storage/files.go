package storage

import (
	"crypto/sha256"
	"fmt"
	"image"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

var allowedMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

var videoMIME = map[string]string{
	"video/mp4":  ".mp4",
	"video/webm": ".webm",
}

var archiveMIME = map[string]string{
	"application/zip": ".zip",
}

var audioMIME = map[string]string{
	"audio/mpeg": ".mp3",
	"audio/ogg":  ".ogg",
	"audio/wav":  ".wav",
	"audio/flac": ".flac",
	"audio/mp4":  ".m4a",
	"audio/x-m4a": ".m4a",
	"audio/aac":  ".aac",
}

type FileStore struct {
	DataDir string
}

type StoredFile struct {
	Path      string
	ThumbPath string
	Width     int
	Height    int
}

func NewFileStore(dataDir string) *FileStore {
	return &FileStore{DataDir: dataDir}
}

func (fs *FileStore) IsAllowedMIME(mime string) bool {
	_, ok := allowedMIME[mime]
	return ok
}

func (fs *FileStore) Store(file multipart.File, mimeType string) (*StoredFile, error) {
	ext, ok := allowedMIME[mimeType]
	if !ok {
		return nil, fmt.Errorf("unsupported MIME type: %s", mimeType)
	}

	// Read file into temp to compute hash
	tmpFile, err := os.CreateTemp("", "upload-*")
	if err != nil {
		return nil, fmt.Errorf("create temp: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmpFile, hasher), file); err != nil {
		return nil, fmt.Errorf("copy file: %w", err)
	}

	hash := fmt.Sprintf("%x", hasher.Sum(nil))

	// Hash-based path: uploads/ab/cd/<hash>.ext
	relDir := filepath.Join("uploads", hash[:2], hash[2:4])
	absDir := filepath.Join(fs.DataDir, relDir)
	if err := os.MkdirAll(absDir, 0755); err != nil {
		return nil, fmt.Errorf("create upload dir: %w", err)
	}

	relPath := filepath.Join(relDir, hash+ext)
	absPath := filepath.Join(fs.DataDir, relPath)

	// Copy temp to final location (skip if exists = dedup)
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		tmpFile.Seek(0, 0)
		dst, err := os.Create(absPath)
		if err != nil {
			return nil, fmt.Errorf("create file: %w", err)
		}
		if _, err := io.Copy(dst, tmpFile); err != nil {
			dst.Close()
			return nil, fmt.Errorf("write file: %w", err)
		}
		dst.Close()
	}

	// Decode with EXIF auto-orientation so dimensions and thumbnail
	// reflect the orientation the browser will display.
	tmpFile.Seek(0, 0)
	img, decodeErr := imaging.Decode(tmpFile, imaging.AutoOrientation(true))
	width, height := 0, 0
	if decodeErr == nil {
		b := img.Bounds()
		width = b.Dx()
		height = b.Dy()
	}

	// Generate thumbnail
	thumbRelPath := ""
	thumbRelDir := filepath.Join("thumbs", hash[:2], hash[2:4])
	thumbAbsDir := filepath.Join(fs.DataDir, thumbRelDir)
	thumbRelPath = filepath.Join(thumbRelDir, hash+".jpg")
	thumbAbsPath := filepath.Join(fs.DataDir, thumbRelPath)

	if decodeErr != nil {
		thumbRelPath = ""
	} else if _, err := os.Stat(thumbAbsPath); os.IsNotExist(err) {
		if err := os.MkdirAll(thumbAbsDir, 0755); err == nil {
			if err := writeThumbnail(img, thumbAbsPath, 400); err != nil {
				// Non-fatal — just no thumbnail
				thumbRelPath = ""
			}
		}
	}

	result := &StoredFile{
		Path:   relPath,
		Width:  width,
		Height: height,
	}
	if thumbRelPath != "" {
		result.ThumbPath = thumbRelPath
	}
	return result, nil
}

func writeThumbnail(img image.Image, destPath string, maxWidth int) error {
	if img.Bounds().Dx() > maxWidth {
		img = imaging.Resize(img, maxWidth, 0, imaging.Lanczos)
	}
	return imaging.Save(img, destPath, imaging.JPEGQuality(80))
}

func DetectMIME(file multipart.File) (string, error) {
	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil {
		return "", err
	}
	if _, err := file.Seek(0, 0); err != nil {
		return "", err
	}
	ct := http.DetectContentType(buf[:n])
	ct = strings.Split(ct, ";")[0]
	return strings.TrimSpace(ct), nil
}

func (fs *FileStore) IsVideoMIME(mime string) bool {
	_, ok := videoMIME[mime]
	return ok
}

// StoreVideo stores a video file using hash-based deduplication (no thumbnails or dimensions).
func (fs *FileStore) StoreVideo(file multipart.File, mimeType string) (string, error) {
	ext, ok := videoMIME[mimeType]
	if !ok {
		return "", fmt.Errorf("unsupported video MIME type: %s", mimeType)
	}

	tmpFile, err := os.CreateTemp("", "video-*")
	if err != nil {
		return "", fmt.Errorf("create temp: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmpFile, hasher), file); err != nil {
		return "", fmt.Errorf("copy file: %w", err)
	}

	hash := fmt.Sprintf("%x", hasher.Sum(nil))

	relDir := filepath.Join("uploads", hash[:2], hash[2:4])
	absDir := filepath.Join(fs.DataDir, relDir)
	if err := os.MkdirAll(absDir, 0755); err != nil {
		return "", fmt.Errorf("create upload dir: %w", err)
	}

	relPath := filepath.Join(relDir, hash+ext)
	absPath := filepath.Join(fs.DataDir, relPath)

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		tmpFile.Seek(0, 0)
		dst, err := os.Create(absPath)
		if err != nil {
			return "", fmt.Errorf("create file: %w", err)
		}
		if _, err := io.Copy(dst, tmpFile); err != nil {
			dst.Close()
			return "", fmt.Errorf("write file: %w", err)
		}
		dst.Close()
	}

	return relPath, nil
}

func (fs *FileStore) IsAudioMIME(mime string) bool {
	_, ok := audioMIME[mime]
	return ok
}

// StoreAudio stores an audio file using hash-based deduplication.
func (fs *FileStore) StoreAudio(file multipart.File, mimeType string) (string, error) {
	ext, ok := audioMIME[mimeType]
	if !ok {
		return "", fmt.Errorf("unsupported audio MIME type: %s", mimeType)
	}

	tmpFile, err := os.CreateTemp("", "audio-*")
	if err != nil {
		return "", fmt.Errorf("create temp: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmpFile, hasher), file); err != nil {
		return "", fmt.Errorf("copy file: %w", err)
	}

	hash := fmt.Sprintf("%x", hasher.Sum(nil))

	relDir := filepath.Join("uploads", hash[:2], hash[2:4])
	absDir := filepath.Join(fs.DataDir, relDir)
	if err := os.MkdirAll(absDir, 0755); err != nil {
		return "", fmt.Errorf("create upload dir: %w", err)
	}

	relPath := filepath.Join(relDir, hash+ext)
	absPath := filepath.Join(fs.DataDir, relPath)

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		tmpFile.Seek(0, 0)
		dst, err := os.Create(absPath)
		if err != nil {
			return "", fmt.Errorf("create file: %w", err)
		}
		if _, err := io.Copy(dst, tmpFile); err != nil {
			dst.Close()
			return "", fmt.Errorf("write file: %w", err)
		}
		dst.Close()
	}

	return relPath, nil
}

func (fs *FileStore) IsArchiveMIME(mime string) bool {
	_, ok := archiveMIME[mime]
	return ok
}

// StoreArchive stores a zip archive using hash-based deduplication. The archive
// is treated as an opaque blob — it is never extracted, decoded, or inspected.
func (fs *FileStore) StoreArchive(file multipart.File, mimeType string) (string, error) {
	ext, ok := archiveMIME[mimeType]
	if !ok {
		return "", fmt.Errorf("unsupported archive MIME type: %s", mimeType)
	}

	tmpFile, err := os.CreateTemp("", "archive-*")
	if err != nil {
		return "", fmt.Errorf("create temp: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmpFile, hasher), file); err != nil {
		return "", fmt.Errorf("copy file: %w", err)
	}

	hash := fmt.Sprintf("%x", hasher.Sum(nil))

	relDir := filepath.Join("uploads", hash[:2], hash[2:4])
	absDir := filepath.Join(fs.DataDir, relDir)
	if err := os.MkdirAll(absDir, 0755); err != nil {
		return "", fmt.Errorf("create upload dir: %w", err)
	}

	relPath := filepath.Join(relDir, hash+ext)
	absPath := filepath.Join(fs.DataDir, relPath)

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		tmpFile.Seek(0, 0)
		dst, err := os.Create(absPath)
		if err != nil {
			return "", fmt.Errorf("create file: %w", err)
		}
		if _, err := io.Copy(dst, tmpFile); err != nil {
			dst.Close()
			return "", fmt.Errorf("write file: %w", err)
		}
		dst.Close()
	}

	return relPath, nil
}

func (fs *FileStore) RemoveFile(relPath string) error {
	return os.Remove(filepath.Join(fs.DataDir, relPath))
}
