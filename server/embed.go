package main

import (
	"embed"
	"io/fs"
)

//go:embed static/*
var staticFiles embed.FS

func StaticSubFS() (fs.FS, error) {
	return fs.Sub(staticFiles, "static")
}
