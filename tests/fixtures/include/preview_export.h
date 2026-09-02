/* Stands in for the header CMake's generate_export_header() writes. Nobody
   writes this by hand and nobody wants to read it, so it must not produce a
   page: it matches the generator's default exclude patterns, and would be
   dropped in any case for having nothing documented in it. */

#ifndef PREVIEW_EXPORT_H
#define PREVIEW_EXPORT_H

#define PREVIEW_EXPORT __attribute__((visibility("default")))
#define PREVIEW_NO_EXPORT __attribute__((visibility("hidden")))

#endif
