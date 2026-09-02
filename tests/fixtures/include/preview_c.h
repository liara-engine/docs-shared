/**
 * @file preview_c.h
 * @brief Synthetic C surface: the shapes a real C module actually produces.
 *
 * Everything in this header exists to pin down one behaviour of the
 * generator, and every one of them was a visible defect at some point:
 * anonymous enums printed under the name Doxygen invented for them, macro
 * invocations listed as functions, `@retval` and `@pre` silently dropped,
 * and a project's own `@threadsafety` reading as an ordinary sentence.
 */

#ifndef LIARA_PREVIEW_C_H
#define LIARA_PREVIEW_C_H

#include <stddef.h>

/** Expands to a compile-time assertion. Function-like macros keep their
 *  parameter list in the signature. */
#define LIARA_PREVIEW_STATIC_ASSERT(condition, message) \
    _Static_assert(condition, message)

/** The widest channel index the preview accepts. */
#define LIARA_PREVIEW_MAX_CHANNELS 64u

/**
 * @brief Preview ABI version components.
 *
 * An unnamed enum: in C this is how a group of related integer constants is
 * spelled, and Doxygen names it `@` followed by forty digits. The generator
 * names it after the prefix its enumerators share instead.
 */
enum {
    LIARA_PREVIEW_VERSION_MAJOR = 1, /**< Incompatible changes. */
    LIARA_PREVIEW_VERSION_MINOR = 4, /**< Backward-compatible additions. */
    LIARA_PREVIEW_VERSION_PATCH = 0  /**< Everything else. */
};

/* Macro invocations at file scope. Doxygen reports each of these as a
   function declaration with no return type, and they used to appear in the
   Functions section of this page. */
LIARA_PREVIEW_STATIC_ASSERT(LIARA_PREVIEW_VERSION_MAJOR >= 1, "major version too low");
LIARA_PREVIEW_STATIC_ASSERT(LIARA_PREVIEW_MAX_CHANNELS <= 256u, "too many channels");

/** @brief How a preview call ended. */
typedef enum liara_preview_status {
    LIARA_PREVIEW_OK = 0,      /**< The call did what it says. */
    LIARA_PREVIEW_EINVAL = -1, /**< An argument was rejected. */
    LIARA_PREVIEW_EBUSY = -2   /**< The channel is choked; retry later. */
} liara_preview_status;

/**
 * @brief A channel's identity and current state.
 */
struct liara_preview_channel {
    unsigned id;      /**< Index into the channel table. */
    unsigned flags;   /**< Bitmask; see @ref liara_preview_status. */
    size_t   pending; /**< Bytes queued but not yet flushed. */
};

/**
 * @brief Opens a preview channel.
 *
 * @param[out] channel Receives the opened channel. Never written on failure.
 * @param[in]  id      Channel index, strictly below
 *                     @ref LIARA_PREVIEW_MAX_CHANNELS.
 *
 * @return A status code.
 * @retval LIARA_PREVIEW_OK     The channel is open and owned by the caller.
 * @retval LIARA_PREVIEW_EINVAL @p id is out of range, or @p channel is null.
 * @retval LIARA_PREVIEW_EBUSY  The channel is already open elsewhere.
 *
 * @pre  The preview subsystem has been initialised.
 * @post On success, the caller owns @p channel until it closes it.
 * @note Opening a channel does not allocate.
 * @warning Closing a channel twice is undefined.
 * @since 0.1.0
 * @see liara_preview_describe
 *
 * @threadsafety Safe to call from any thread; channels are opened under an
 * internal lock. @endthreadsafety
 */
liara_preview_status liara_preview_open(struct liara_preview_channel *channel,
                                        unsigned id);

/**
 * @brief Names a status code.
 *
 * @param status The code to name.
 * @return A static, never-null, lowercase string.
 *
 * @par Allocation
 * None. The returned pointer is valid for the lifetime of the process.
 *
 * @deprecated Use `liara_preview_status_name` once it exists. Kept so the
 *             deprecation notice has something to render.
 */
const char *liara_preview_describe(liara_preview_status status);

/* No documentation at all: still part of the surface, so it is listed at the
   foot of the page rather than dropped or given a card. */
int liara_preview_reset(void);

#endif /* LIARA_PREVIEW_C_H */
