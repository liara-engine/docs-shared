/**
 * @file sample.hpp
 * @brief Synthetic API surface that exercises the shared Doxygen template.
 *
 * Nothing here is real. It exists so a docs-shared PR can confirm that groups,
 * classes, templates, enums, parameter tables, admonitions, code blocks and
 * cross-references all still render with the shared template.
 */

#pragma once

#include <cstdint>
#include <span>
#include <string_view>
#include <stdexcept>

/**
 * @defgroup preview_fixtures Preview fixtures
 * @brief Everything in this header belongs to a single documentation group.
 * @{
 */

/// The engine's top-level namespace (synthetic).
namespace liara::preview {

/**
 * @brief Global compile-time configuration constants.
 *
 * This exercises how global variables, types, and constants render in the
 * member declaration tables (`table.memberdecls`).
 */
inline constexpr std::uint32_t MaxChannels = 64;

/**
 * @brief Severity levels for a synthetic log channel.
 *
 * Documented enumerators show up in the member table.
 */
enum class Severity : std::uint8_t {
    Trace,   ///< Verbose tracing, usually disabled.
    Info,    ///< Normal operational messages.
    Warning, ///< Recoverable problems.
    Fatal    ///< Unrecoverable; the process should stop.
};

/**
 * @brief A low-level hardware or packet configuration overlay.
 *
 * Exercises how a plain @c struct and an anonymous @c union render within
 * the Liara Engine design system.
 */
struct HardwareOverlay {
    std::uint32_t id; ///< Unique hardware identifier.

    union {
        std::uint32_t raw_flags; ///< Combined bitmask of all status flags.
        struct {
            bool is_active : 1;  ///< Component operational state.
            bool has_error : 1;  ///< Error state indicator.
        } bits;                  ///< Bit-level access.
    } status;                    ///< Status union container.
};

/**
 * @brief A fixed-capacity ring buffer.
 *
 * @tparam T        Element type. Must be trivially copyable.
 * @tparam Capacity Maximum number of live elements.
 *
 * @note This type performs no heap allocation.
 * @warning Pushing into a full buffer overwrites the oldest element.
 */
template <typename T, std::size_t Capacity>
class RingBuffer {
public:
    /// Constructs an empty buffer.
    constexpr RingBuffer() noexcept = default;

    /**
     * @brief Appends an element, overwriting the oldest if full.
     * @param value The element to store.
     * @return @c true if an element was overwritten, @c false otherwise.
     */
    constexpr bool push(const T& value) noexcept;

    /**
     * @brief Number of live elements.
     * @return A value in the range <tt>[0, Capacity]</tt>.
     */
    [[nodiscard]] constexpr std::size_t size() const noexcept { return size_; }

private:
    T data_[Capacity]{};   ///< Backing storage.
    std::size_t head_ = 0; ///< Index of the next write.
    std::size_t size_ = 0; ///< Live element count.
};

/**
 * @brief Formats a severity level for display.
 *
 * Example:
 * @code{.cpp}
 * auto label = liara::preview::to_string(liara::preview::Severity::Warning);
 * // label == "warning"
 * @endcode
 *
 * @param level The severity to format.
 * @return A stable, lowercase string view. Never empty.
 * @see Severity
 */
[[nodiscard]] std::string_view to_string(Severity level) noexcept;

/**
 * @brief Sums a span of integers.
 * @deprecated Use the ranges-based overload instead. Kept to exercise the
 *             "deprecated" admonition in the template.
 * @param values The integers to add.
 * @return Their sum, or @c 0 for an empty span. See @ref to_string for the
 *         unrelated string helper.
 */
[[deprecated]] std::int64_t sum(std::span<const std::int32_t> values) noexcept;

/**
 * @brief Dispatches a transactional command payload to the engine core.
 *
 * This heavy synthetic function is explicitly designed to stress-test every
 * single customized admonition box, parameter layout, exception table,
 * and return-value block defined inside @c doxygen-custom.css.
 *
 * @param channel_id The destination pipeline index. Must be strictly less than @ref MaxChannels.
 * @param payload    A view over the raw byte sequence to transmit.
 *
 * @retval true  The transaction was successfully committed and processed.
 * @retval false The command was rejected because the channel is currently choked.
 *
 * @exception std::out_of_range Thrown if @p channel_id exceeds @ref MaxChannels.
 * @exception std::invalid_argument Thrown if the @p payload size is zero.
 *
 * @attention High frequency calls to this function can incur hardware bus lockups.
 * @bug Context switching timings are unstable under highly nested interrupts.
 * @todo Implement hardware fallback queues before the next preview release.
 *
 * @pre The engine subsystem must be initialized via @c liara::core::init().
 * @post The targeted channel will transition to a busy state until flushed.
 *
 * @threadsafety This function is thread-safe and can be invoked from concurrent context pipelines. @endthreadsafety
 *
 * @see to_string
 */
bool dispatch_command(std::uint32_t channel_id, std::span<const std::byte> payload);

} // namespace liara::preview

/** @} */ // end of preview_fixtures